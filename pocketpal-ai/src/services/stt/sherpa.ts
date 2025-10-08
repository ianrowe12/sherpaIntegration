import {NativeModules, PermissionsAndroid, Platform} from 'react-native';
import RNFS from '@dr.pogodin/react-native-fs';

const MODEL_DIR_ANDROID = 'sherpa-onnx-streaming-zipformer-en-2023-06-21-mobile';
const MODEL_DIR_IOS = 'Models';
const SAMPLE_RATE = 16000;

const {TTSManager} = NativeModules as {
  TTSManager?: {
    initializeSTT: (config: string) => void;
    startRecognition: () => void;
    stopRecognition: () => Promise<string> | string;
    deinitializeSTT?: () => void;
  };
};

type MaybePromise<T> = Promise<T> | T;

type SherpaManager = NonNullable<typeof TTSManager>;

let initPromise: Promise<void> | null = null;
let initialized = false;

const ensureModule = (): SherpaManager => {
  if (!TTSManager) {
    throw new Error('Sherpa STT native module is unavailable');
  }
  return TTSManager;
};

const buildModelConfig = async () => {
  if (Platform.OS === 'android') {
    return {
      encoder: `${MODEL_DIR_ANDROID}/encoder-epoch-99-avg-1.int8.onnx`,
      decoder: `${MODEL_DIR_ANDROID}/decoder-epoch-99-avg-1.onnx`,
      joiner: `${MODEL_DIR_ANDROID}/joiner-epoch-99-avg-1.int8.onnx`,
      tokens: `${MODEL_DIR_ANDROID}/tokens.txt`,
      sampleRate: SAMPLE_RATE,
    };
  }

  const basePath = `${RNFS.MainBundlePath}/${MODEL_DIR_IOS}`;
  const resolve = async (file: string) => {
    const candidate = `${basePath}/${file}`;
    const exists = await RNFS.exists(candidate);
    return exists ? candidate : `${MODEL_DIR_IOS}/${file}`;
  };

  return {
    encoder: await resolve('encoder-epoch-99-avg-1.int8.onnx'),
    decoder: await resolve('decoder-epoch-99-avg-1.onnx'),
    joiner: await resolve('joiner-epoch-99-avg-1.int8.onnx'),
    tokens: await resolve('tokens.txt'),
    sampleRate: SAMPLE_RATE,
  };
};

const callMaybePromise = async <T>(fn: () => MaybePromise<T>): Promise<T> =>
  Promise.resolve().then(fn);

export const initializeSherpaStt = async () => {
  if (initialized) {
    return;
  }
  if (!initPromise) {
    initPromise = (async () => {
      const manager = ensureModule();
      const config = await buildModelConfig();
      manager.initializeSTT(JSON.stringify(config));
      initialized = true;
    })().catch(error => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
};

export const requestSherpaMicPermission = async (): Promise<boolean> => {
  if (Platform.OS === 'android') {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }
  return true;
};

export const startPushToTalk = async () => {
  await initializeSherpaStt();
  const manager = ensureModule();
  manager.startRecognition();
};

export const stopPushToTalk = async (): Promise<string> => {
  const manager = ensureModule();
  const result = await callMaybePromise(() => manager.stopRecognition());
  return (result ?? '').trim();
};

export const deinitializeSherpaStt = async () => {
  if (!TTSManager?.deinitializeSTT) {
    return;
  }
  await callMaybePromise(() => TTSManager.deinitializeSTT?.());
  initialized = false;
  initPromise = null;
};
