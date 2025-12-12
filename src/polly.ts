import { PollyClient, SynthesizeSpeechCommand, VoiceId, Engine, OutputFormat } from "@aws-sdk/client-polly";

// Initialize Polly client
export const pollyClient = new PollyClient({
  region: process.env.AWS_REGION || "us-east-1",
});

export interface PollyOptions {
  voiceId?: VoiceId;
  engine?: Engine;
  outputFormat?: OutputFormat;
  sampleRate?: string;
  languageCode?: string;
}

/**
 * Convert text to speech using Amazon Polly
 */
export async function synthesizeSpeech(
  text: string,
  options: PollyOptions = {}
): Promise<Buffer> {
  const {
    voiceId = VoiceId.Joanna, // Natural, warm female voice similar to OpenAI's Nova
    engine = Engine.neural,
    outputFormat = OutputFormat.mp3,
    sampleRate = "22050",
    languageCode = "en-US"
  } = options;

  try {
    const command = new SynthesizeSpeechCommand({
      Text: text,
      VoiceId: voiceId,
      Engine: engine,
      OutputFormat: outputFormat,
      SampleRate: sampleRate,
      LanguageCode: languageCode,
    });

    const response = await pollyClient.send(command);

    if (!response.AudioStream) {
      throw new Error("No audio stream in Polly response");
    }

    // Convert the stream to a buffer
    const chunks: Uint8Array[] = [];
    const reader = response.AudioStream.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    // Combine all chunks into a single buffer
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return Buffer.from(result);
  } catch (error) {
    console.error("Polly synthesis error:", error);
    throw new Error(`Failed to synthesize speech: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get available voices for a specific language
 */
export function getVoiceForLanguage(languageCode: string): { voiceId: VoiceId; languageCode: string } {
  // Map language codes to appropriate Polly voices
  const voiceMapping: Record<string, { voiceId: VoiceId; languageCode: string }> = {
    'en': { voiceId: VoiceId.Joanna, languageCode: 'en-US' },
    'en-US': { voiceId: VoiceId.Joanna, languageCode: 'en-US' },
    'en-GB': { voiceId: VoiceId.Emma, languageCode: 'en-GB' },
    'es': { voiceId: VoiceId.Lupe, languageCode: 'es-US' },
    'es-ES': { voiceId: VoiceId.Conchita, languageCode: 'es-ES' },
    'es-MX': { voiceId: VoiceId.Mia, languageCode: 'es-MX' },
    'fr': { voiceId: VoiceId.Celine, languageCode: 'fr-FR' },
    'fr-FR': { voiceId: VoiceId.Celine, languageCode: 'fr-FR' },
    'de': { voiceId: VoiceId.Marlene, languageCode: 'de-DE' },
    'de-DE': { voiceId: VoiceId.Marlene, languageCode: 'de-DE' },
    'it': { voiceId: VoiceId.Carla, languageCode: 'it-IT' },
    'it-IT': { voiceId: VoiceId.Carla, languageCode: 'it-IT' },
    'pt': { voiceId: VoiceId.Camila, languageCode: 'pt-BR' },
    'pt-BR': { voiceId: VoiceId.Camila, languageCode: 'pt-BR' },
    'pt-PT': { voiceId: VoiceId.Ines, languageCode: 'pt-PT' },
    'ja': { voiceId: VoiceId.Mizuki, languageCode: 'ja-JP' },
    'ja-JP': { voiceId: VoiceId.Mizuki, languageCode: 'ja-JP' },
    'zh': { voiceId: VoiceId.Zhiyu, languageCode: 'zh-CN' },
    'zh-CN': { voiceId: VoiceId.Zhiyu, languageCode: 'zh-CN' },
    'ar': { voiceId: VoiceId.Zeina, languageCode: 'ar-AE' },
    'ar-AE': { voiceId: VoiceId.Zeina, languageCode: 'ar-AE' },
    'ru': { voiceId: VoiceId.Tatyana, languageCode: 'ru-RU' },
    'ru-RU': { voiceId: VoiceId.Tatyana, languageCode: 'ru-RU' },
  };

  return voiceMapping[languageCode] || { voiceId: VoiceId.Joanna, languageCode: 'en-US' };
}

/**
 * Synthesize speech with automatic voice selection based on language
 */
export async function synthesizeSpeechWithLanguage(
  text: string,
  languageCode: string = 'en-US',
  options: Omit<PollyOptions, 'voiceId' | 'languageCode'> = {}
): Promise<Buffer> {
  const { voiceId, languageCode: pollyLanguageCode } = getVoiceForLanguage(languageCode);

  return synthesizeSpeech(text, {
    ...options,
    voiceId,
    languageCode: pollyLanguageCode,
  });
}