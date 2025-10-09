// Whisper integration removed. Keep stubs so imports do not break older code paths.
export type WhisperContext = {
  transcribe: (path: string, opts?: any) => {promise: Promise<{result: string}>};
};

export const initDefaultWhisper = async (): Promise<WhisperContext> => {
  return {
    transcribe: (_path: string) => ({
      promise: Promise.resolve({result: ''}),
    }),
  };
};

export const getWhisperContext = async (): Promise<WhisperContext> => {
  return initDefaultWhisper();
};
