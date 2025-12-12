import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  DeleteConnectionCommand
} from "@aws-sdk/client-apigatewaymanagementapi";
import {
  DynamoDBClient,
  PutItemCommand,
  DeleteItemCommand,
  QueryCommand,
  ScanCommand
} from "@aws-sdk/client-dynamodb";

// DynamoDB client for connection management
// DynamoDB client for connection management
const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

// API Gateway Management API client (will be initialized per connection)
const createApiGatewayClient = (endpoint: string) => {
  return new ApiGatewayManagementApiClient({
    region: process.env.AWS_REGION || 'us-east-1',
    endpoint,
  });
};

interface WebSocketConnection {
  connectionId: string;
  restaurantId: string;
  customerSessionId?: string;
  role: 'customer' | 'chef';
  userId?: string;
  connectedAt: string;
  endpoint: string;
}

export class ApiGatewayWebSocketManager {
  private connectionsTable: string;

  constructor() {
    this.connectionsTable = process.env.WEBSOCKET_CONNECTIONS_TABLE || 'waiterix-websocket-connections';
  }

  // Store connection in DynamoDB
  async storeConnection(connection: WebSocketConnection): Promise<void> {
    const params = {
      TableName: this.connectionsTable,
      Item: {
        connectionId: { S: connection.connectionId },
        restaurantId: { S: connection.restaurantId },
        role: { S: connection.role },
        connectedAt: { S: connection.connectedAt },
        endpoint: { S: connection.endpoint },
        ...(connection.customerSessionId && {
          customerSessionId: { S: connection.customerSessionId }
        }),
        ...(connection.userId && {
          userId: { S: connection.userId }
        }),
      },
    };

    const command = new PutItemCommand(params);
    await dynamoClient.send(command);

    console.log(`WebSocket connection stored: ${connection.connectionId} for restaurant ${connection.restaurantId}`);
  }

  // Remove connection from DynamoDB
  async removeConnection(connectionId: string): Promise<void> {
    const params = {
      TableName: this.connectionsTable,
      Key: {
        connectionId: { S: connectionId },
      },
    };

    const command = new DeleteItemCommand(params);
    await dynamoClient.send(command);

    console.log(`WebSocket connection removed: ${connectionId}`);
  }

  // Get connections for a restaurant and role
  async getConnections(restaurantId: string, role?: 'customer' | 'chef', customerSessionId?: string): Promise<WebSocketConnection[]> {
    let params;

    if (role === 'chef') {
      // Get chef connections for restaurant
      params = {
        TableName: this.connectionsTable,
        FilterExpression: 'restaurantId = :restaurantId AND #role = :role',
        ExpressionAttributeNames: {
          '#role': 'role',
        },
        ExpressionAttributeValues: {
          ':restaurantId': { S: restaurantId },
          ':role': { S: 'chef' },
        },
      };
    } else if (role === 'customer' && customerSessionId) {
      // Get specific customer session connections
      params = {
        TableName: this.connectionsTable,
        FilterExpression: 'restaurantId = :restaurantId AND #role = :role AND customerSessionId = :sessionId',
        ExpressionAttributeNames: {
          '#role': 'role',
        },
        ExpressionAttributeValues: {
          ':restaurantId': { S: restaurantId },
          ':role': { S: 'customer' },
          ':sessionId': { S: customerSessionId },
        },
      };
    } else {
      // Get all connections for restaurant
      params = {
        TableName: this.connectionsTable,
        FilterExpression: 'restaurantId = :restaurantId',
        ExpressionAttributeValues: {
          ':restaurantId': { S: restaurantId },
        },
      };
    }

    const command = new ScanCommand(params);
    const result = await dynamoClient.send(command);

    return (result.Items || []).map(item => ({
      connectionId: item.connectionId.S!,
      restaurantId: item.restaurantId.S!,
      role: item.role.S! as 'customer' | 'chef',
      connectedAt: item.connectedAt.S!,
      endpoint: item.endpoint.S!,
      customerSessionId: item.customerSessionId?.S,
      userId: item.userId?.S,
    }));
  }

  // Send message to specific connection
  async sendToConnection(connectionId: string, endpoint: string, data: any): Promise<boolean> {
    try {
      const apiGatewayClient = createApiGatewayClient(endpoint);

      const command = new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify(data),
      });

      await apiGatewayClient.send(command);
      return true;
    } catch (error: any) {
      console.error(`Failed to send message to connection ${connectionId}:`, error);

      // If connection is stale (410 Gone), remove it from DynamoDB
      if (error.$metadata?.httpStatusCode === 410) {
        console.log(`Removing stale connection: ${connectionId}`);
        await this.removeConnection(connectionId);
      }

      return false;
    }
  }

  // Send message to multiple connections
  async sendToConnections(connections: WebSocketConnection[], data: any): Promise<void> {
    const promises = connections.map(connection =>
      this.sendToConnection(connection.connectionId, connection.endpoint, data)
    );

    await Promise.allSettled(promises);
  }

  // Notify chef dashboard about new question
  async notifyChefNewQuestion(restaurantId: string, questionData: any): Promise<void> {
    const chefConnections = await this.getConnections(restaurantId, 'chef');

    if (chefConnections.length > 0) {
      await this.sendToConnections(chefConnections, {
        type: 'new-question',
        data: questionData,
      });

      console.log(`Notified ${chefConnections.length} chef(s) about new question for restaurant ${restaurantId}`);
    }
  }

  // Send chef answer to customer
  async sendChefAnswerToCustomer(restaurantId: string, customerSessionId: string, answerData: any): Promise<void> {
    const customerConnections = await this.getConnections(restaurantId, 'customer', customerSessionId);

    if (customerConnections.length > 0) {
      await this.sendToConnections(customerConnections, {
        type: 'chef-answer',
        data: answerData,
      });

      console.log(`Sent chef answer to customer ${customerSessionId} in restaurant ${restaurantId}`);
    }
  }

  // Broadcast to all clients in a restaurant
  async broadcast(restaurantId: string, data: any): Promise<void> {
    const allConnections = await this.getConnections(restaurantId);

    if (allConnections.length > 0) {
      await this.sendToConnections(allConnections, data);
      console.log(`Broadcasted message to ${allConnections.length} connections in restaurant ${restaurantId}`);
    }
  }

  // Notify about order status changes
  async notifyOrderStatusChange(restaurantId: string, orderData: any): Promise<void> {
    // Notify chef dashboard
    const chefConnections = await this.getConnections(restaurantId, 'chef');

    if (chefConnections.length > 0) {
      await this.sendToConnections(chefConnections, {
        type: 'order-status-changed',
        data: orderData,
      });
    }

    // Also broadcast to all customer sessions in this restaurant (for tracking pages)
    const customerConnections = await this.getConnections(restaurantId, 'customer');

    if (customerConnections.length > 0) {
      await this.sendToConnections(customerConnections, {
        type: 'order-status-changed',
        data: orderData,
      });
    }

    console.log(`Notified about order status change for order ${orderData.orderId} in restaurant ${restaurantId}`);
  }

  // Notify chef dashboard about new assistance request
  async notifyNewAssistanceRequest(restaurantId: string, requestData: any): Promise<void> {
    const chefConnections = await this.getConnections(restaurantId, 'chef');

    if (chefConnections.length > 0) {
      await this.sendToConnections(chefConnections, {
        type: 'new-assistance-request',
        data: requestData,
      });

      console.log(`Notified ${chefConnections.length} chef(s) about new assistance request for restaurant ${restaurantId}`);
    }
  }

  // Clean up stale connections (can be called periodically)
  async cleanupStaleConnections(): Promise<void> {
    const params = {
      TableName: this.connectionsTable,
    };

    const command = new ScanCommand(params);
    const result = await dynamoClient.send(command);

    if (!result.Items) return;

    const staleConnections: string[] = [];
    const now = Date.now();
    const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours

    for (const item of result.Items) {
      const connectedAt = new Date(item.connectedAt.S!).getTime();
      if (now - connectedAt > staleThreshold) {
        staleConnections.push(item.connectionId.S!);
      }
    }

    // Remove stale connections
    const deletePromises = staleConnections.map(connectionId =>
      this.removeConnection(connectionId)
    );

    await Promise.allSettled(deletePromises);

    if (staleConnections.length > 0) {
      console.log(`Cleaned up ${staleConnections.length} stale WebSocket connections`);
    }
  }
}

// Export singleton instance
export const apiGatewayWebSocketManager = new ApiGatewayWebSocketManager();

// Lambda handlers for WebSocket events
export const handleConnect = async (event: any) => {
  const { connectionId } = event.requestContext;
  const { restaurantId, customerSessionId, role = 'customer' } = event.queryStringParameters || {};

  if (!restaurantId) {
    return {
      statusCode: 400,
      body: 'Missing restaurantId parameter',
    };
  }

  const connection: WebSocketConnection = {
    connectionId,
    restaurantId,
    customerSessionId,
    role: role as 'customer' | 'chef',
    connectedAt: new Date().toISOString(),
    endpoint: `https://${event.requestContext.domainName}/${event.requestContext.stage}`,
  };

  try {
    await apiGatewayWebSocketManager.storeConnection(connection);

    return {
      statusCode: 200,
      body: 'Connected',
    };
  } catch (error) {
    console.error('Error storing WebSocket connection:', error);
    return {
      statusCode: 500,
      body: 'Failed to connect',
    };
  }
};

export const handleDisconnect = async (event: any) => {
  const { connectionId } = event.requestContext;

  try {
    await apiGatewayWebSocketManager.removeConnection(connectionId);

    return {
      statusCode: 200,
      body: 'Disconnected',
    };
  } catch (error) {
    console.error('Error removing WebSocket connection:', error);
    return {
      statusCode: 500,
      body: 'Failed to disconnect',
    };
  }
};

export const handleMessage = async (event: any) => {
  const { connectionId } = event.requestContext;

  try {
    const message = JSON.parse(event.body);

    // Handle different message types
    switch (message.type) {
      case 'ping':
        const endpoint = `https://${event.requestContext.domainName}/${event.requestContext.stage}`;
        await apiGatewayWebSocketManager.sendToConnection(connectionId, endpoint, { type: 'pong' });
        break;
      default:
        console.log('Unknown message type:', message.type);
    }

    return {
      statusCode: 200,
      body: 'Message processed',
    };
  } catch (error) {
    console.error('Error processing WebSocket message:', error);
    return {
      statusCode: 500,
      body: 'Failed to process message',
    };
  }
};