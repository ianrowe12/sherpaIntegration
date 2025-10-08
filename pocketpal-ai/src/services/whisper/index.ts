import * as RNFS from '@dr.pogodin/react-native-fs';
import {Platform} from 'react-native';
import {downloadManager} from '../downloads';
import {WhisperContext, initWhisper} from 'whisper.rn';

export type WhisperModelSpec = {
  id: string;
  filename: string; // e.g. ggml-tiny.en.bin
  size?: number; // optional expected size in bytes
  downloadUrl?: string; // optional fallback remote URL
};

const WHISPER_DIR = Platform.select({
  ios: `${RNFS.DocumentDirectoryPath}/whisper`,
  android: `${RNFS.DocumentDirectoryPath}/whisper`,
}) as string;

export const getWhisperModelPath = (filename: string): string => {
  return `${WHISPER_DIR}/${filename}`;
};

export const ensureWhisperModel = async (
  spec: WhisperModelSpec,
  options?: {authToken?: string | null},
): Promise<string> => {
  const modelPath = getWhisperModelPath(spec.filename);

  try {
    const exists = await RNFS.exists(modelPath);
    if (exists) {
      return modelPath;
    }
  } catch {}

  await RNFS.mkdir(WHISPER_DIR);

  if (spec.downloadUrl) {
    // Fallback to a sensible default size to pass storage checks if not provided
    const inferredSize =
      spec.size ??
      (spec.filename.includes('tiny')
        ? 80 * 1024 * 1024 // ~80 MB
        : spec.filename.includes('base')
        ? 150 * 1024 * 1024 // ~150 MB
        : spec.filename.includes('small')
        ? 500 * 1024 * 1024 // ~500 MB
        : spec.filename.includes('medium')
        ? 1600 * 1024 * 1024 // ~1.6 GB
        : spec.filename.includes('large')
        ? 3000 * 1024 * 1024 // ~3.0 GB
        : 100 * 1024 * 1024); // default ~100 MB

    // Leverage existing DownloadManager for progress and resilience
    await downloadManager.startDownload(
      {
        id: spec.id,
        author: 'openai',
        name: spec.filename,
        type: 'whisper',
        capabilities: [],
        size: inferredSize,
        params: 0,
        isDownloaded: false,
        downloadUrl: spec.downloadUrl,
        hfUrl: spec.downloadUrl,
        progress: 0,
        filename: spec.filename,
        fullPath: modelPath,
        isLocal: true,
        origin: 1 as any, // ModelOrigin.LOCAL
      } as any,
      modelPath,
      options?.authToken ?? null,
    );
    return modelPath;
  }

  // If no download URL was provided, expect the asset to be bundled and copied by user
  throw new Error(
    `Whisper model not found at ${modelPath} and no downloadUrl provided.`,
  );
};

let whisperContextPromise: Promise<WhisperContext> | null = null;

export const initDefaultWhisper = async (): Promise<WhisperContext> => {
  const modelPath = await ensureWhisperModel({
    id: 'whisper-tiny-en',
    filename: 'ggml-tiny.en.bin',
    downloadUrl:
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin?download=true',
  });

  whisperContextPromise = initWhisper({filePath: modelPath});
  return whisperContextPromise;
};

export const getWhisperContext = async (): Promise<WhisperContext> => {
  if (whisperContextPromise) return whisperContextPromise;
  return initDefaultWhisper();
};


