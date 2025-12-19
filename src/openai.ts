import OpenAI from "openai";

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
// This is using Replit's AI Integrations service, which provides OpenAI-compatible API access without requiring your own OpenAI API key.
export const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY
});

// For audio endpoints (speech, transcription), we need to use the direct OpenAI API
// since AI Integrations doesn't support these endpoints
export const openaiAudio = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

export interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Generate content using OpenAI
 */
export async function generateWithOpenAI(
  messages: OpenAIMessage[],
  options: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    systemPrompt?: string;
    model?: string;
  } = {}
): Promise<string> {
  const {
    maxTokens = 4096,
    temperature = 0.7,
    topP = 1,
    systemPrompt,
    model = "gpt-4o"
  } = options;

  const conversationMessages: OpenAIMessage[] = [];

  if (systemPrompt) {
    conversationMessages.push({ role: "system", content: systemPrompt });
  }

  conversationMessages.push(...messages);

  try {
    const response = await openai.chat.completions.create({
      model: model,
      messages: conversationMessages as any,
      max_tokens: maxTokens,
      temperature: temperature,
      top_p: topP,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No content in OpenAI response");
    }

    return content;
  } catch (error) {
    console.error("OpenAI generation error:", error);
    throw new Error(`Failed to generate content with OpenAI: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
