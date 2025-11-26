import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

// Initialize Bedrock Runtime client
export const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ClaudeResponse {
  content: Array<{
    type: "text";
    text: string;
  }>;
  id: string;
  model: string;
  role: "assistant";
  stop_reason: string;
  stop_sequence: null;
  type: "message";
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Generate content using Claude 3.5 Sonnet via AWS Bedrock
 */
export async function generateWithClaude(
  messages: ClaudeMessage[],
  options: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    systemPrompt?: string;
  } = {}
): Promise<string> {
  const {
    maxTokens = 4096,
    temperature = 0.7,
    topP = 1,
    systemPrompt
  } = options;

  const requestBody = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: maxTokens,
    temperature,
    top_p: topP,
    messages: messages.map(msg => ({
      role: msg.role,
      content: msg.content
    })),
    ...(systemPrompt && { system: systemPrompt })
  };

  try {
    const command = new InvokeModelCommand({
      modelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(requestBody),
    });

    const response = await bedrockClient.send(command);
    
    if (!response.body) {
      throw new Error("No response body from Bedrock");
    }

    const responseBody = JSON.parse(new TextDecoder().decode(response.body)) as ClaudeResponse;
    
    if (!responseBody.content || responseBody.content.length === 0) {
      throw new Error("No content in Claude response");
    }

    return responseBody.content[0].text;
  } catch (error) {
    console.error("Claude generation error:", error);
    throw new Error(`Failed to generate content with Claude: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generate content with a simple text prompt (convenience function)
 */
export async function generateTextWithClaude(
  prompt: string,
  options: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    systemPrompt?: string;
  } = {}
): Promise<string> {
  const messages: ClaudeMessage[] = [
    { role: "user", content: prompt }
  ];

  return generateWithClaude(messages, options);
}

/**
 * Generate content with conversation history
 */
export async function generateConversationWithClaude(
  conversationHistory: ClaudeMessage[],
  newMessage: string,
  options: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    systemPrompt?: string;
  } = {}
): Promise<string> {
  const messages: ClaudeMessage[] = [
    ...conversationHistory,
    { role: "user", content: newMessage }
  ];

  return generateWithClaude(messages, options);
}