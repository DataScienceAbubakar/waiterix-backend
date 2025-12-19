import { PollyClient, SynthesizeSpeechCommand, VoiceId, Engine, OutputFormat } from "@aws-sdk/client-polly";
import { Readable } from "stream";

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
): Promise<Readable> {
  const {
    voiceId = VoiceId.Joanna, // Natural, warm female voice similar to OpenAI's Nova
    engine = Engine.NEURAL,
    outputFormat = OutputFormat.MP3,
    sampleRate = "22050",
    languageCode = "en-US"
  } = options;

  console.log(`[Polly] Synthesizing speech: "${text.substring(0, 50)}..." with voice ${voiceId}`);

  try {
    const command = new SynthesizeSpeechCommand({
      Text: text,
      VoiceId: voiceId,
      Engine: engine,
      OutputFormat: outputFormat,
      SampleRate: sampleRate,
      LanguageCode: languageCode as any,
    });

    const response = await pollyClient.send(command);

    if (!response.AudioStream) {
      throw new Error("No audio stream in Polly response");
    }

    // Return the stream directly. In Node.js environment with SDK v3,
    // this is compatible with Readable.
    return response.AudioStream as Readable;
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
): Promise<Readable> {
  const { voiceId, languageCode: pollyLanguageCode } = getVoiceForLanguage(languageCode);

  return synthesizeSpeech(text, {
    ...options,
    voiceId,
    languageCode: pollyLanguageCode,
  });
}