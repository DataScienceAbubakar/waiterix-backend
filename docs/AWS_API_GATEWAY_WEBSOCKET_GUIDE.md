# AWS API Gateway WebSocket Setup for OpenAI Realtime API

This guide walks you through setting up AWS API Gateway WebSocket to enable real-time voice conversations with ~300-800ms latency using OpenAI's Realtime API.

## Architecture Overview

```
┌─────────────┐     WebSocket      ┌──────────────────────┐
│   Browser   │ ◄─────────────────► │  API Gateway WS API  │
│  (Frontend) │                     │   (wss://...)        │
└─────────────┘                     └──────────┬───────────┘
                                               │
                                    Lambda Functions
                                               │
              ┌────────────────────────────────┼────────────────────────────────┐
              │                                │                                │
     ┌────────▼────────┐           ┌──────────▼──────────┐          ┌──────────▼──────────┐
     │  $connect       │           │  $default           │          │  $disconnect        │
     │  (Connection)   │           │  (Audio Relay)      │          │  (Cleanup)          │
     └────────┬────────┘           └──────────┬──────────┘          └─────────────────────┘
              │                                │
              │                   ┌────────────▼────────────┐
              │                   │  OpenAI Realtime API    │
              │                   │  (wss://api.openai.com) │
              │                   └─────────────────────────┘
              │
     ┌────────▼────────┐
     │   DynamoDB      │
     │  (Connections)  │
     └─────────────────┘
```

## Prerequisites

1. **AWS Account** with permissions for:
   - API Gateway
   - Lambda
   - DynamoDB
   - IAM

2. **OpenAI API Key** with access to Realtime API

3. **Serverless Framework** installed

## Step 1: Create the OpenAI Realtime Lambda Handler

Create a new file `src/handlers/openaiRealtimeHandler.ts`:

```typescript
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { 
  ApiGatewayManagementApiClient, 
  PostToConnectionCommand 
} from '@aws-sdk/client-apigatewaymanagementapi';
import { 
  DynamoDBClient, 
  PutItemCommand, 
  DeleteItemCommand, 
  GetItemCommand 
} from '@aws-sdk/client-dynamodb';
import WebSocket from 'ws';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const CONNECTIONS_TABLE = process.env.REALTIME_CONNECTIONS_TABLE || 'waiterix-realtime-connections';

// Store for OpenAI WebSocket connections (per Lambda instance)
const openaiConnections = new Map<string, WebSocket>();

/**
 * Handle new WebSocket connection
 */
export const handleConnect = async (event: any): Promise<APIGatewayProxyResult> => {
  const connectionId = event.requestContext.connectionId;
  const { restaurantId, language = 'en' } = event.queryStringParameters || {};

  if (!restaurantId) {
    return { statusCode: 400, body: 'Missing restaurantId' };
  }

  // Store connection in DynamoDB
  await dynamoClient.send(new PutItemCommand({
    TableName: CONNECTIONS_TABLE,
    Item: {
      connectionId: { S: connectionId },
      restaurantId: { S: restaurantId },
      language: { S: language },
      connectedAt: { S: new Date().toISOString() },
      endpoint: { S: `https://${event.requestContext.domainName}/${event.requestContext.stage}` },
    },
  }));

  console.log(`[Realtime] Connection established: ${connectionId}`);
  
  return { statusCode: 200, body: 'Connected' };
};

/**
 * Handle WebSocket disconnection
 */
export const handleDisconnect = async (event: any): Promise<APIGatewayProxyResult> => {
  const connectionId = event.requestContext.connectionId;

  // Close OpenAI connection if exists
  const openaiWs = openaiConnections.get(connectionId);
  if (openaiWs) {
    openaiWs.close();
    openaiConnections.delete(connectionId);
  }

  // Remove from DynamoDB
  await dynamoClient.send(new DeleteItemCommand({
    TableName: CONNECTIONS_TABLE,
    Key: { connectionId: { S: connectionId } },
  }));

  console.log(`[Realtime] Connection closed: ${connectionId}`);
  
  return { statusCode: 200, body: 'Disconnected' };
};

/**
 * Handle incoming messages (audio, commands)
 */
export const handleMessage = async (event: any): Promise<APIGatewayProxyResult> => {
  const connectionId = event.requestContext.connectionId;
  const endpoint = `https://${event.requestContext.domainName}/${event.requestContext.stage}`;
  
  const apiGatewayClient = new ApiGatewayManagementApiClient({ 
    region: process.env.AWS_REGION,
    endpoint 
  });

  try {
    const message = JSON.parse(event.body);

    switch (message.type) {
      case 'start_session':
        await startOpenAISession(connectionId, message, apiGatewayClient);
        break;

      case 'audio':
        // Relay audio to OpenAI
        const openaiWs = openaiConnections.get(connectionId);
        if (openaiWs?.readyState === WebSocket.OPEN) {
          openaiWs.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: message.audio,
          }));
        }
        break;

      case 'commit_audio':
        const ws = openaiConnections.get(connectionId);
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
          ws.send(JSON.stringify({ type: 'response.create' }));
        }
        break;

      case 'cancel':
        const cancelWs = openaiConnections.get(connectionId);
        if (cancelWs?.readyState === WebSocket.OPEN) {
          cancelWs.send(JSON.stringify({ type: 'response.cancel' }));
        }
        break;

      case 'end_session':
        const endWs = openaiConnections.get(connectionId);
        if (endWs) {
          endWs.close();
          openaiConnections.delete(connectionId);
        }
        break;

      case 'ping':
        await sendToClient(apiGatewayClient, connectionId, { type: 'pong' });
        break;
    }

    return { statusCode: 200, body: 'OK' };
  } catch (error) {
    console.error('[Realtime] Error handling message:', error);
    return { statusCode: 500, body: 'Error' };
  }
};

/**
 * Start OpenAI Realtime session
 */
async function startOpenAISession(
  connectionId: string, 
  config: any, 
  apiGatewayClient: ApiGatewayManagementApiClient
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    await sendToClient(apiGatewayClient, connectionId, { 
      type: 'error', 
      error: 'OpenAI API key not configured' 
    });
    return;
  }

  // Get connection info from DynamoDB
  const connectionData = await dynamoClient.send(new GetItemCommand({
    TableName: CONNECTIONS_TABLE,
    Key: { connectionId: { S: connectionId } },
  }));

  const restaurantId = connectionData.Item?.restaurantId?.S;
  const language = connectionData.Item?.language?.S || 'en';

  // Connect to OpenAI Realtime API
  const openaiUrl = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';
  
  const openaiWs = new WebSocket(openaiUrl, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'OpenAI-Beta': 'realtime=v1',
    },
  });

  openaiConnections.set(connectionId, openaiWs);

  openaiWs.on('open', () => {
    console.log(`[Realtime] OpenAI connection opened for ${connectionId}`);
    
    // Configure session
    openaiWs.send(JSON.stringify({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: getSystemPrompt(restaurantId, config.restaurantName, language),
        voice: 'alloy',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
        tools: [
          {
            type: 'function',
            name: 'add_to_cart',
            description: 'Add a menu item to the cart',
            parameters: {
              type: 'object',
              properties: {
                item_name: { type: 'string', description: 'Name of the menu item' },
                quantity: { type: 'integer', description: 'Quantity to add', default: 1 },
              },
              required: ['item_name'],
            },
          },
        ],
        tool_choice: 'auto',
      },
    }));
  });

  openaiWs.on('message', async (data: Buffer) => {
    try {
      const event = JSON.parse(data.toString());
      await handleOpenAIEvent(event, connectionId, apiGatewayClient);
    } catch (error) {
      console.error('[Realtime] Error parsing OpenAI message:', error);
    }
  });

  openaiWs.on('error', (error) => {
    console.error(`[Realtime] OpenAI WebSocket error for ${connectionId}:`, error);
    sendToClient(apiGatewayClient, connectionId, { type: 'error', error: 'OpenAI connection error' });
  });

  openaiWs.on('close', () => {
    console.log(`[Realtime] OpenAI connection closed for ${connectionId}`);
    openaiConnections.delete(connectionId);
  });
}

/**
 * Handle events from OpenAI
 */
async function handleOpenAIEvent(
  event: any, 
  connectionId: string, 
  apiGatewayClient: ApiGatewayManagementApiClient
) {
  switch (event.type) {
    case 'session.created':
      await sendToClient(apiGatewayClient, connectionId, { type: 'session_started' });
      break;

    case 'response.audio.delta':
      // Relay audio to client
      if (event.delta) {
        await sendToClient(apiGatewayClient, connectionId, {
          type: 'audio',
          audio: event.delta,
        });
      }
      break;

    case 'conversation.item.input_audio_transcription.completed':
      await sendToClient(apiGatewayClient, connectionId, {
        type: 'transcript',
        transcript: event.transcript,
        role: 'user',
        isFinal: true,
      });
      break;

    case 'response.function_call_arguments.done':
      if (event.name === 'add_to_cart') {
        try {
          const args = JSON.parse(event.arguments || '{}');
          await sendToClient(apiGatewayClient, connectionId, {
            type: 'add_to_cart',
            item: {
              name: args.item_name,
              quantity: args.quantity || 1,
            },
          });
        } catch (e) {
          console.error('[Realtime] Error parsing function call:', e);
        }
      }
      break;

    case 'response.done':
      await sendToClient(apiGatewayClient, connectionId, { type: 'response_done' });
      break;

    case 'error':
      await sendToClient(apiGatewayClient, connectionId, { 
        type: 'error', 
        error: event.error?.message || 'Unknown error' 
      });
      break;
  }
}

/**
 * Send message to client via API Gateway
 */
async function sendToClient(
  client: ApiGatewayManagementApiClient, 
  connectionId: string, 
  data: any
) {
  try {
    await client.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(data),
    }));
  } catch (error: any) {
    if (error.$metadata?.httpStatusCode === 410) {
      console.log(`[Realtime] Stale connection: ${connectionId}`);
      openaiConnections.get(connectionId)?.close();
      openaiConnections.delete(connectionId);
    } else {
      console.error(`[Realtime] Error sending to ${connectionId}:`, error);
    }
  }
}

/**
 * Generate system prompt for AI waiter
 */
function getSystemPrompt(restaurantId: string | undefined, restaurantName: string, language: string): string {
  return `You are a friendly AI waiter at ${restaurantName || 'this restaurant'}. 

Your personality:
- Warm, welcoming, and conversational
- Keep responses concise (1-2 sentences when possible)
- Be enthusiastic about recommendations

Your capabilities:
- Help customers explore the menu
- Answer questions about dishes
- Add items to cart when requested

Speak in ${language === 'en' ? 'English' : language}.`;
}
```

## Step 2: Update serverless.yml

Add the following to your `serverless.yml`:

```yaml
# Add to provider.environment:
provider:
  environment:
    REALTIME_CONNECTIONS_TABLE: waiterix-realtime-connections
    OPENAI_API_KEY: ${env:OPENAI_API_KEY, ''}

# Add to provider.iam.role.statements:
  iam:
    role:
      statements:
        - Effect: Allow
          Action:
            - dynamodb:PutItem
            - dynamodb:GetItem
            - dynamodb:DeleteItem
          Resource:
            - 'arn:aws:dynamodb:${self:provider.region}:*:table/waiterix-realtime-connections'

# Add new functions:
functions:
  # ... existing functions ...
  
  realtimeConnect:
    handler: src/handlers/openaiRealtimeHandler.handleConnect
    events:
      - websocket:
          route: $connect
          routeResponseSelectionExpression: $default

  realtimeDisconnect:
    handler: src/handlers/openaiRealtimeHandler.handleDisconnect
    events:
      - websocket:
          route: $disconnect

  realtimeMessage:
    handler: src/handlers/openaiRealtimeHandler.handleMessage
    timeout: 29  # Max Lambda timeout
    events:
      - websocket:
          route: $default

# Add to resources:
resources:
  Resources:
    RealtimeConnectionsTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: waiterix-realtime-connections
        AttributeDefinitions:
          - AttributeName: connectionId
            AttributeType: S
        KeySchema:
          - AttributeName: connectionId
            KeyType: HASH
        BillingMode: PAY_PER_REQUEST
```

## Step 3: Deploy

```bash
# Set your OpenAI API key
export OPENAI_API_KEY=sk-your-key-here

# Deploy
npx serverless deploy
```

After deployment, you'll see output like:
```
endpoints:
  wss://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/dev
```

## Step 4: Update Frontend

Update your `.env` file or Amplify environment variables:

```env
VITE_REALTIME_WEBSOCKET_URL=wss://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/dev
```

Then update `CustomerMenu.tsx` to use the RealtimeAIWaiter:

```tsx
// Uncomment this:
import { RealtimeAIWaiter, RealtimeAIWaiterRef } from "@/components/RealtimeAIWaiter";

// And use it instead of FloatingAIWaiter
```

## Important Limitations

### 1. Lambda Timeout (29 seconds max)
AWS Lambda has a maximum timeout of 29 seconds for API Gateway integrations. This means:
- Each WebSocket message is handled by a separate Lambda invocation
- The OpenAI connection needs to be re-established for each message
- This adds latency compared to a persistent server

### 2. Cold Starts
Lambda cold starts can add 1-3 seconds of latency on first connection.

### 3. Cost Considerations
- Lambda: ~$0.20 per 1M requests
- API Gateway WebSocket: $1.00 per 1M messages
- DynamoDB: ~$0.25 per 1M writes
- OpenAI Realtime: ~$0.30 per minute of audio

## Alternative: EC2/ECS for Better Performance

For better latency and persistent connections, consider:

1. **EC2 Instance**: Run the Node.js WebSocket server directly
2. **ECS/Fargate**: Containerized deployment
3. **Elastic Beanstalk**: Managed Node.js environment

These options maintain persistent connections to OpenAI, eliminating the reconnection overhead.

## Troubleshooting

### Connection Fails Immediately
- Check CloudWatch Logs for the Lambda function
- Verify the OPENAI_API_KEY is set correctly
- Ensure DynamoDB table exists

### High Latency
- Lambda cold starts - use provisioned concurrency
- Consider EC2/ECS for persistent connections

### Audio Not Playing
- Check browser console for errors
- Verify audio format matches (PCM16, 24kHz)
- Test with Chrome DevTools Network tab

## Security Best Practices

1. **Never hardcode API keys** - Use environment variables
2. **Restrict CORS** - Only allow your frontend domain
3. **Validate restaurantId** - Verify it exists before creating session
4. **Rate limiting** - Use API Gateway throttling
5. **Monitor usage** - Set up CloudWatch alarms for unusual activity
