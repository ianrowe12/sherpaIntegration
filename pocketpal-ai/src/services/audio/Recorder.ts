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
    // VAD continuous
    'startVadRecognition',
    'stopVadRecognition',
  ];
  const missing = requiredFns.filter(
    fnName => typeof (SherpaSTT as any)[fnName] !== 'function',
  );
  if (missing.length) {
    console.warn(`${TAG} missing native functions`, missing);
    throw new Error(`Missing Sherpa native functions: ${missing.join(', ')}`);
  }
};

export async function startRecording(maxMs?: number): Promise<StreamingSession> {
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
  if (typeof maxMs === 'number' && maxMs > 0) {
    currentTimeout = setTimeout(() => {
      console.log(`${TAG} timeout reached, auto-stopping`);
      void stopRecording().catch(err =>
        console.warn(`${TAG} auto-stop encountered error`, err),
      );
    }, maxMs);
  }

  inFlightSession = {
    stop: async () => {
      console.log(`${TAG} stop requested`);
      stopCurrent();
      try {
        const text = await SherpaSTT.stopRecognition?.();
        console.log(`${TAG} stopRecognition resolved`, text);
        return text ?? '';
      } finally {
        // Keep recognizer warm between sessions; do not deinitialize here
        inFlightSession = null;
      }
    },
    cancel: () => {
      console.log(`${TAG} cancel requested`);
      stopCurrent();
      // Keep recognizer warm; do not deinitialize here
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
    // Keep recognizer alive; do not deinitialize if no session
    return '';
  }
  try {
    return await inFlightSession.stop();
  } catch (error) {
    console.warn(`${TAG} stopRecording failed`, error);
    // Keep recognizer alive even on failure
    return '';
  } finally {
    inFlightSession = null;
  }
}

// Continuous VAD-driven ASR
let vadSubscription: { remove?: () => void } | null = null;
let asrSegmentHandler: ((text: string) => void) | null = null;

export function setAsrSegmentHandler(handler: (text: string) => void) {
  asrSegmentHandler = handler;
}

export function clearAsrSegmentHandler() {
  asrSegmentHandler = null;
}

export async function startVadContinuous(): Promise<void> {
  console.log(`${TAG} startVadContinuous`);
  ensureNativeApi();
  // Ensure initialized (preload should have done this). If not, build config and init.
  try {
    const cfg = await ensureSherpaModelConfig();
    (SherpaSTT as any)?.initializeSTT?.(cfg);
  } catch {}

  // Listen for finalized segments from native
  try {
    const { NativeEventEmitter, NativeModules } = require('react-native');
    const emitter = new NativeEventEmitter(NativeModules.TTSManager);
    vadSubscription?.remove?.();
    vadSubscription = emitter.addListener('ASRSegment', (e: { text?: string }) => {
      const text = e?.text?.trim?.() ?? '';
      if (text) {
        console.log(`${TAG} VAD segment`, text);
        try {
          asrSegmentHandler?.(text);
        } catch (err) {
          console.warn(`${TAG} segment handler error`, err);
        }
      }
    });
  } catch (err) {
    console.warn(`${TAG} failed to attach ASRSegment listener`, err);
  }

  (SherpaSTT as any)?.startVadRecognition?.();
}

export async function stopVadContinuous(): Promise<void> {
  console.log(`${TAG} stopVadContinuous`);
  (SherpaSTT as any)?.stopVadRecognition?.();
  try {
    vadSubscription?.remove?.();
  } catch {}
  vadSubscription = null;
}


