import SherpaSTT from 'react-native-sherpa-onnx-offline-tts';

import {ensureSherpaModelConfig} from '../stt/sherpa';

const TAG = '[SherpaRecorder]';

export type StreamingSession = {
  stop: () => Promise<string>;
  cancel: () => void;
};

let currentTimeout: ReturnType<typeof setTimeout> | null = null;
let inFlightSession: StreamingSession | null = null;

const stopCurrent = () => {
  if (currentTimeout) {
    console.log(`${TAG} clearing timeout`);
    clearTimeout(currentTimeout);
    currentTimeout = null;
  }
};

const ensureNativeApi = () => {
  if (!SherpaSTT) {
    throw new Error('Sherpa native module not available');
  }
  console.log(`${TAG} native module keys`, Object.keys(SherpaSTT));
  const requiredFns: Array<keyof typeof SherpaSTT> = [
    'initializeSTT',
    'startRecognition',
    'stopRecognition',
    'deinitializeSTT',
  ];
  const missing = requiredFns.filter(
    fnName => typeof (SherpaSTT as any)[fnName] !== 'function',
  );
  if (missing.length) {
    console.warn(`${TAG} missing native functions`, missing);
    throw new Error(`Missing Sherpa native functions: ${missing.join(', ')}`);
  }
};

export async function startRecording(maxMs = 30000): Promise<StreamingSession> {
  console.log(`${TAG} start invoked (maxMs=${maxMs})`);
  if (inFlightSession) {
    console.log(`${TAG} cancelling existing session before starting new`);
    inFlightSession.cancel();
    inFlightSession = null;
  }

  ensureNativeApi();

  let config: string;
  try {
    console.log(`${TAG} building Sherpa model config`);
    config = await ensureSherpaModelConfig();
    console.log(`${TAG} config ready`);
  } catch (error) {
    console.warn(`${TAG} failed to build config`, error);
    throw error;
  }

  try {
    console.log(`${TAG} calling initializeSTT`);
    SherpaSTT.initializeSTT?.(config);
    console.log(`${TAG} calling startRecognition`);
    SherpaSTT.startRecognition?.();
  } catch (error) {
    console.warn(`${TAG} initialize/start failed`, error);
    SherpaSTT.deinitializeSTT?.();
    throw error;
  }

  stopCurrent();
  currentTimeout = setTimeout(() => {
    console.log(`${TAG} timeout reached, auto-stopping`);
    void stopRecording().catch(err =>
      console.warn(`${TAG} auto-stop encountered error`, err),
    );
  }, maxMs);

  inFlightSession = {
    stop: async () => {
      console.log(`${TAG} stop requested`);
      stopCurrent();
      try {
        const text = await SherpaSTT.stopRecognition?.();
        console.log(`${TAG} stopRecognition resolved`, text);
        return text ?? '';
      } finally {
        SherpaSTT.deinitializeSTT?.();
        inFlightSession = null;
      }
    },
    cancel: () => {
      console.log(`${TAG} cancel requested`);
      stopCurrent();
      SherpaSTT.deinitializeSTT?.();
      inFlightSession = null;
    },
  };

  return inFlightSession;
}

export async function stopRecording(): Promise<string> {
  console.log(`${TAG} stopRecording called`);
  stopCurrent();
  if (!inFlightSession) {
    console.log(`${TAG} no active session, just deinitializing`);
    SherpaSTT.deinitializeSTT?.();
    return '';
  }
  try {
    return await inFlightSession.stop();
  } catch (error) {
    console.warn(`${TAG} stopRecording failed`, error);
    SherpaSTT.deinitializeSTT?.();
    return '';
  } finally {
    inFlightSession = null;
  }
}


