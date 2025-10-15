import {Platform, NativeModules} from 'react-native';
import * as RNFSModule from '@dr.pogodin/react-native-fs';

const RNFS = (RNFSModule as any)?.default ?? RNFSModule;
const TAG = '[SherpaConfig]';

console.log(`${TAG} RNFS keys`, Object.keys(RNFS || {}));

if (!RNFS || !RNFS.DocumentDirectoryPath) {
  console.warn(`${TAG} RNFS module missing or malformed`, Object.keys(RNFS || {}));
  throw new Error('RNFS module not available');
}

const ANDROID_ASSET_PREFIX = 'asset:/sherpa-stt';

const MODEL_FILES = {
  encoder: 'encoder-epoch-99-avg-1.int8.onnx',
  decoder: 'decoder-epoch-99-avg-1.onnx',
  joiner: 'joiner-epoch-99-avg-1.int8.onnx',
  tokens: 'tokens.txt',
};

export type SherpaConfig = {
  encoder: string;
  decoder: string;
  joiner: string;
  tokens: string;
  vadModel?: string;
  sampleRate: number;
};

const getCandidateDirs = (): string[] => {
  const dirs: Array<string | null | undefined> = [];
  const mainBundle = RNFS.MainBundlePath;
  const docsDir = RNFS.DocumentDirectoryPath;
  if (mainBundle) {
    dirs.push(`${mainBundle}/SherpaSTT`, mainBundle);
  }
  dirs.push(`${docsDir}/SherpaSTT`, docsDir);
  return dirs.filter(Boolean) as string[];
};

async function resolveModelFile(filename: string): Promise<string> {
  const candidates = getCandidateDirs();
  for (const dir of candidates) {
    const candidate = `${dir}/${filename}`;
    try {
      const exists = await RNFS.exists(candidate);
      if (exists) {
        return candidate;
      }
    } catch (error) {
      console.warn(`${TAG} error checking path ${candidate}`, error);
    }
  }
  throw new Error(`Missing required file: ${filename}`);
}

async function ensureIosFiles(): Promise<SherpaConfig> {
  const encoder = await resolveModelFile(MODEL_FILES.encoder);
  const decoder = await resolveModelFile(MODEL_FILES.decoder);
  const joiner = await resolveModelFile(MODEL_FILES.joiner);
  const tokens = await resolveModelFile(MODEL_FILES.tokens);
  // VAD model is optional; attempt to resolve silero_vad.onnx next to other files
  let vadModel: string | undefined;
  try {
    vadModel = await resolveModelFile('silero_vad.onnx');
  } catch {}

  const config: SherpaConfig = {
    encoder,
    decoder,
    joiner,
    tokens,
    vadModel,
    sampleRate: 16000,
  };

  console.log(`${TAG} resolved iOS asset paths`, config);
  return config;
}

function ensureAndroidFiles(): SherpaConfig {
  const prefix = ANDROID_ASSET_PREFIX;
  const config: SherpaConfig = {
    encoder: `${prefix}/${MODEL_FILES.encoder}`,
    decoder: `${prefix}/${MODEL_FILES.decoder}`,
    joiner: `${prefix}/${MODEL_FILES.joiner}`,
    tokens: `${prefix}/${MODEL_FILES.tokens}`,
    sampleRate: 16000,
  };
  console.log(`${TAG} using Android asset paths`, config);
  return config;
}

export async function ensureSherpaModelConfig(): Promise<string> {
  console.log(`${TAG} ensureSherpaModelConfig invoked (platform=${Platform.OS})`);
  try {
    const config = Platform.OS === 'ios' ? await ensureIosFiles() : ensureAndroidFiles();
    return JSON.stringify(config);
  } catch (error) {
    console.warn(`${TAG} failed to produce config`, error);
    throw error;
  }
}
