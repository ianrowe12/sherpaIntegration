declare module 'whisper.rn' {
  export type TranscribeResult = {
    result: string;
    segments: Array<{ text: string; t0: number; t1: number }>;
    isAborted: boolean;
  };
  export type TranscribeOptions = {
    language?: string;
    translate?: boolean;
    maxThreads?: number;
  };
  export class WhisperContext {
    transcribe(
      filePathOrBase64: string | number,
      options?: TranscribeOptions,
    ): { stop: () => Promise<void>; promise: Promise<TranscribeResult> };
  }
  export function initWhisper(params: { filePath: string }): Promise<WhisperContext>;
}


