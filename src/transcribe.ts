import { TranscribeClient, StartTranscriptionJobCommand, GetTranscriptionJobCommand, LanguageCode, MediaFormat } from "@aws-sdk/client-transcribe";
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

// Initialize clients
export const transcribeClient = new TranscribeClient({
  region: process.env.AWS_REGION || "us-east-1",
});

export const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
});

export interface TranscriptionOptions {
  languageCode?: string;
  mediaFormat?: string;
  sampleRate?: number;
}

/**
 * Transcribe audio using AWS Transcribe
 * Note: This is a simplified implementation. For production, consider using
 * streaming transcription or a more robust file handling system.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  options: TranscriptionOptions = {}
): Promise<string> {
  const {
    languageCode = 'en-US',
    mediaFormat = 'webm',
    sampleRate = 48000
  } = options;

  const bucketName = process.env.AWS_S3_TRANSCRIBE_BUCKET || 'waiterix-transcribe-temp';
  const jobName = `transcribe-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const fileName = `${jobName}.${mediaFormat}`;
  const s3Key = `audio/${fileName}`;
  const mediaUri = `s3://${bucketName}/${s3Key}`;

  try {
    // Upload audio file to S3
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
      Body: audioBuffer,
      ContentType: `audio/${mediaFormat}`,
    }));

    // Start transcription job
    await transcribeClient.send(new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      LanguageCode: languageCode as LanguageCode,
      Media: {
        MediaFileUri: mediaUri,
      },
      MediaFormat: mediaFormat as MediaFormat,
      // MediaSampleRateHertz: sampleRate, // Removed to let AWS Transcribe auto-detect sample rate
      OutputBucketName: bucketName,
      OutputKey: `transcripts/${jobName}.json`,
    }));

    // Poll for completion
    let jobStatus = 'IN_PROGRESS';
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes max wait time
    let failureReason = '';

    while (jobStatus === 'IN_PROGRESS' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

      const jobResult = await transcribeClient.send(new GetTranscriptionJobCommand({
        TranscriptionJobName: jobName,
      }));

      jobStatus = jobResult.TranscriptionJob?.TranscriptionJobStatus || 'FAILED';
      if (jobStatus === 'FAILED') {
        failureReason = jobResult.TranscriptionJob?.FailureReason || 'Unknown failure reason';
      }
      attempts++;
    }

    if (jobStatus !== 'COMPLETED') {
      throw new Error(`Transcription job failed with status: ${jobStatus}. Reason: ${failureReason}`);
    }

    // Get the transcription result
    // Note: When OutputBucketName is specified, we must read the object using S3 client
    // because the TranscriptFileUri is a standard S3 URI, not a pre-signed URL.
    const outputKey = `transcripts/${jobName}.json`;

    const getObjectCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: outputKey,
    });

    const response = await s3Client.send(getObjectCommand);
    const bodyContents = await response.Body?.transformToString();

    if (!bodyContents) {
      throw new Error('Empty transcript body');
    }

    const transcriptData = JSON.parse(bodyContents);
    const transcript = transcriptData.results?.transcripts?.[0]?.transcript;

    if (!transcript) {
      throw new Error('No transcript found in result');
    }

    // Clean up temporary files
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
      }));
      await s3Client.send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: `transcripts/${jobName}.json`,
      }));
    } catch (cleanupError) {
      console.warn('Failed to clean up temporary files:', cleanupError);
    }

    return transcript;
  } catch (error) {
    console.error("Transcription error:", error);

    // Attempt cleanup on error
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
      }));
    } catch (cleanupError) {
      console.warn('Failed to clean up audio file on error:', cleanupError);
    }

    throw new Error(`Failed to transcribe audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Simple in-memory transcription for smaller audio files
 * This is a placeholder - AWS Transcribe doesn't support direct buffer transcription
 * In practice, you might want to use a different service or implement streaming
 */
export async function transcribeAudioBuffer(
  audioBuffer: Buffer,
  mimeType: string = 'audio/webm',
  languageCode: string = 'en-US'
): Promise<string> {
  // Extract format from mime type (e.g. 'audio/webm;codecs=opus' -> 'webm')
  const baseMime = mimeType.split(';')[0]; // Remove parameters like codecs
  const mediaFormat = baseMime.split('/')[1] || 'webm';

  // Validate supported formats (basic check)
  const supportedFormats = ['mp3', 'mp4', 'wav', 'flac', 'ogg', 'amr', 'webm'];
  if (!supportedFormats.includes(mediaFormat)) {
    console.warn(`[Transcribe] Unsupported format ${mediaFormat}, defaulting to webm`);
  }

  const validLanguageCode = getTranscribeLanguageCode(languageCode);

  return transcribeAudio(audioBuffer, {
    languageCode: validLanguageCode,
    mediaFormat,
  });
}

/**
 * Get language code mapping for AWS Transcribe
 */
export function getTranscribeLanguageCode(languageCode: string): string {
  const languageMapping: Record<string, string> = {
    'en': 'en-US',
    'es': 'es-US',
    'fr': 'fr-FR',
    'de': 'de-DE',
    'it': 'it-IT',
    'pt': 'pt-BR',
    'ja': 'ja-JP',
    'zh': 'zh-CN',
    'ar': 'ar-AE',
    'ru': 'ru-RU',
  };

  return languageMapping[languageCode] || languageCode;
}