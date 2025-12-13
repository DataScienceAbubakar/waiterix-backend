import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

// Initialize Bedrock Runtime client
// When running in Lambda, credentials are automatically provided via the execution role
// For local development, use AWS CLI profile or environment variables
export const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || "us-east-1",
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
 * Generate content using Amazon Nova via AWS Bedrock
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

  // Amazon Nova format
  const requestBody = {
    messages: messages.map(msg => ({
      role: msg.role,
      content: [{ text: msg.content }]
    })),
    system: systemPrompt ? [{ text: systemPrompt }] : undefined,
    inferenceConfig: {
      max_new_tokens: maxTokens,
      temperature,
      top_p: topP,
    }
  };

  try {
    const command = new InvokeModelCommand({
      modelId: "amazon.nova-pro-v1:0",
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(requestBody),
    });

    const response = await bedrockClient.send(command);

    if (!response.body) {
      throw new Error("No response body from Bedrock");
    }

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    // Nova response format: { output: { message: { content: [{ text: "..." }] } } }
    if (!responseBody.output?.message?.content || responseBody.output.message.content.length === 0) {
      throw new Error("No content in Nova response");
    }

    return responseBody.output.message.content[0].text;
  } catch (error) {
    console.error("Nova generation error:", error);
    throw new Error(`Failed to generate content with Nova: ${error instanceof Error ? error.message : 'Unknown error'}`);
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