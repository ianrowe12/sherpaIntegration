import * as RNFS from '@dr.pogodin/react-native-fs';
import {Platform} from 'react-native';
import {unzip} from 'react-native-zip-archive';
// zip-only extraction to avoid blocking the JS thread with heavy CPU work

import {downloadManager} from '../downloads';
import SherpaTTS from 'react-native-sherpa-onnx-offline-tts';

export type TTSModelSpec = {
  id: string;
  zipUrl: string;
  folderName: string; // e.g. vits-piper-en_US-ryan-medium
  // Optional expected size in bytes (used for free-space checks)
  sizeBytes?: number;
};

const TTS_DIR = Platform.select({
  ios: `${RNFS.DocumentDirectoryPath}/tts`,
  android: `${RNFS.DocumentDirectoryPath}/tts`,
}) as string;

export type TTSAssets = {
  rootDir: string;
  onnxModelPath: string; // First .onnx file found
  tokensPath: string; // tokens.txt
  espeakDataDir: string; // espeak-ng-data directory
};

let ttsReady = false;
export const isTTSReady = () => ttsReady;

const ensureDir = async (path: string) => {
  try {
    await RNFS.mkdir(path);
  } catch {}
};

const listDir = async (dir: string): Promise<ReturnType<typeof RNFS.readDir>> => {
  try {
    return await RNFS.readDir(dir);
  } catch {
    return [] as any;
  }
};

const moveAllChildrenUpAndRemove = async (fromDir: string, toDir: string) => {
  const children = await listDir(fromDir);
  for (const child of children) {
    const dest = `${toDir}/${child.name}`;
    await RNFS.moveFile(child.path, dest);
  }
  await RNFS.unlink(fromDir);
};

const flattenIfSingleSubfolder = async (rootDir: string) => {
  const entries = await listDir(rootDir);
  const onlyDirs = entries.filter(e => e.isDirectory());
  // If archive extracted into a single nested folder, flatten it
  if (entries.length >= 1 && onlyDirs.length === 1 && entries.length === 1) {
    const inner = onlyDirs[0];
    await moveAllChildrenUpAndRemove(inner.path, rootDir);
  }
};

const findFirstOnnx = async (dir: string): Promise<string | null> => {
  const entries = await listDir(dir);
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.onnx')) {
      return entry.path;
    }
  }
  return null;
};

export const getTTSModelRoot = (folderName: string): string =>
  `${TTS_DIR}/${folderName}`;

export const ensureTTSAssets = async (
  spec: TTSModelSpec,
  options?: {authToken?: string | null},
): Promise<TTSAssets> => {
  const modelRoot = getTTSModelRoot(spec.folderName);
  const tokensPath = `${modelRoot}/tokens.txt`;
  const espeakDataDir = `${modelRoot}/espeak-ng-data`;

  await ensureDir(TTS_DIR);
  await ensureDir(modelRoot);

  // Quick happy-path check: already extracted
  const hasTokens = await RNFS.exists(tokensPath);
  const hasEspeak = await RNFS.exists(espeakDataDir);
  const firstOnnxExisting = await findFirstOnnx(modelRoot);
  if (hasTokens && hasEspeak && firstOnnxExisting) {
    return {
      rootDir: modelRoot,
      onnxModelPath: firstOnnxExisting,
      tokensPath,
      espeakDataDir,
    };
  }

  // Download zip to Documents/tts/<folder>.zip
  // Support only .zip to keep extraction fast and non-blocking on the JS thread
  const isTarBz2 = spec.zipUrl.toLowerCase().endsWith('.tar.bz2');
  const archiveName = `${spec.folderName}.zip`;
  const archivePath = `${TTS_DIR}/${archiveName}`;

  const inferredSize = spec.sizeBytes ?? 120 * 1024 * 1024; // default ~120MB

  await downloadManager.startDownload(
    {
      id: `tts-${spec.id}`,
      author: 'piper/vits',
      name: archiveName,
      type: 'tts',
      capabilities: [],
      size: inferredSize,
      params: 0,
      isDownloaded: false,
      downloadUrl: spec.zipUrl,
      hfUrl: spec.zipUrl,
      progress: 0,
      filename: archiveName,
      fullPath: archivePath,
      isLocal: true,
      origin: 1 as any,
    } as any,
    archivePath,
    options?.authToken ?? null,
  );

  if (isTarBz2) {
    throw new Error('TTS: tar.bz2 is not supported in-app. Please use a .zip URL.');
  } else {
    // Unzip into model root
    await unzip(archivePath, modelRoot);
  }

  // Clean up zip to save space
  try {
    await RNFS.unlink(archivePath);
  } catch {}

  // If files are nested in an inner folder, flatten
  await flattenIfSingleSubfolder(modelRoot);

  // Verify required assets
  const onnxPath = await findFirstOnnx(modelRoot);
  const tokensExists = await RNFS.exists(tokensPath);
  const espeakExists = await RNFS.exists(espeakDataDir);

  if (!onnxPath || !tokensExists || !espeakExists) {
    throw new Error(
      'TTS model assets missing after extraction. Expected .onnx model, tokens.txt, and espeak-ng-data directory.',
    );
  }

  return {
    rootDir: modelRoot,
    onnxModelPath: onnxPath,
    tokensPath,
    espeakDataDir,
  };
};

/**
 * Convenience helper for the example Piper/VITS model referenced in docs.
 * Provide the correct zipUrl per the README instructions.
 */
export const ensureExampleRyanMedium = async (
  zipUrl: string,
): Promise<TTSAssets> => {
  return ensureTTSAssets({
    id: 'vits-piper-en_US-ryan-medium',
    zipUrl,
    folderName: 'vits-piper-en_US-ryan-medium',
    sizeBytes: 120 * 1024 * 1024,
  });
};

/** Initialize the native TTS engine given resolved asset paths */
export const initializeTTSFromAssets = async (
  assets: TTSAssets,
  options?: {sampleRate?: number; channels?: number},
): Promise<void> => {
  // Sanity check file existence
  const [mOk, tOk, dOk] = await Promise.all([
    RNFS.exists(assets.onnxModelPath),
    RNFS.exists(assets.tokensPath),
    RNFS.exists(assets.espeakDataDir),
  ]);
  if (!mOk || !tOk || !dOk) {
    console.warn('TTS initialize: missing assets', {
      model: assets.onnxModelPath,
      modelExists: mOk,
      tokens: assets.tokensPath,
      tokensExists: tOk,
      espeakDir: assets.espeakDataDir,
      espeakExists: dOk,
    });
  }
  const cfg = {
    modelPath: assets.onnxModelPath,
    tokensPath: assets.tokensPath,
    dataDirPath: assets.espeakDataDir,
  };
  console.log('TTS initialize with cfg:', cfg);
  // Library expects a JSON string for modelId in initialize()
  // Sample rate and channels are currently fixed (22050, 1) inside the module’s initialize
  // interface; this call just forwards the JSON string to native.
  SherpaTTS.initialize(JSON.stringify(cfg));
  try {
    (SherpaTTS as any).enforcePlayback?.();
  } catch {}
  console.log('TTS initialize() invoked');
  ttsReady = true;
};

/** Try to initialize if a specific folder already contains assets (no download). */
export const tryInitializeTTSFromFolder = async (
  folderName: string,
): Promise<boolean> => {
  const root = getTTSModelRoot(folderName);
  const tokensPath = `${root}/tokens.txt`;
  const espeakDir = `${root}/espeak-ng-data`;
  const onnx = await findFirstOnnx(root);
  const hasTokens = await RNFS.exists(tokensPath);
  const hasEspeak = await RNFS.exists(espeakDir);
  if (onnx && hasTokens && hasEspeak) {
    await initializeTTSFromAssets({
      rootDir: root,
      onnxModelPath: onnx,
      tokensPath,
      espeakDataDir: espeakDir,
    });
    return true;
  }
  return false;
};

/**
 * Speak the given text using the initialized Sherpa-ONNX TTS engine.
 * sid: speaker id (default 0); speed: 1.0 is normal
 */
export const speakText = async (
  text: string,
  options?: {sid?: number; speed?: number},
): Promise<void> => {
  const trimmed = (text || '').trim();
  if (!trimmed) return;
  // Skip segments that are punctuation-only (e.g., a single '!')
  const hasAlphaNum = /[A-Za-z0-9]/.test(trimmed);
  if (!hasAlphaNum) return;

  const sid = options?.sid ?? 0;
  const speed = options?.speed ?? 1.0;
  try {
    if (!ttsReady) {
      // Wait briefly for init to complete (first-run model download)
      const start = Date.now();
      while (!ttsReady && Date.now() - start < 7000) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(r => setTimeout(r, 100));
      }
      if (!ttsReady) {
        console.warn('speakText: TTS not ready after wait');
        return;
      }
    }
    // Re-assert playback session in case recording left the app in record mode
    try {
      (SherpaTTS as any).enforcePlayback?.();
    } catch {}
    await (SherpaTTS as any).generateAndPlay(trimmed, sid, speed);
  } catch (err) {
    console.warn('TTS speakText failed:', err);
  }
};

/** Stop any ongoing speech playback gracefully (Android adds a native stop; noop if missing) */
export const stopSpeaking = (): void => {
  try {
    (SherpaTTS as any).stop?.();
  } catch {}
};

/** Import a locally selected ZIP (uri) and initialize TTS. */
export const importTTSFromZipUri = async (
  zipUri: string,
  folderName = 'vits-piper-en_US-ryan-medium',
): Promise<TTSAssets> => {
  const modelRoot = getTTSModelRoot(folderName);
  await ensureDir(TTS_DIR);
  await ensureDir(modelRoot);

  const localZipPath = `${TTS_DIR}/${folderName}.zip`;
  // Copy or download depending on scheme
  try {
    if (zipUri.startsWith('file://')) {
      await RNFS.copyFile(zipUri.replace('file://', ''), localZipPath);
    } else {
      await RNFS.downloadFile({fromUrl: zipUri, toFile: localZipPath}).promise;
    }
  } catch (e) {
    throw new Error(`Failed to acquire ZIP: ${String(e)}`);
  }

  // Unzip
  try {
    await unzip(localZipPath, modelRoot);
  } catch (e) {
    throw new Error(`Failed to unzip archive: ${String(e)}`);
  } finally {
    try {
      await RNFS.unlink(localZipPath);
    } catch {}
  }

  await flattenIfSingleSubfolder(modelRoot);

  const tokensPath = `${modelRoot}/tokens.txt`;
  const espeakDataDir = `${modelRoot}/espeak-ng-data`;
  const onnxPath = await findFirstOnnx(modelRoot);
  const [tOk, dOk] = await Promise.all([
    RNFS.exists(tokensPath),
    RNFS.exists(espeakDataDir),
  ]);

  if (!onnxPath || !tOk || !dOk) {
    throw new Error('Imported ZIP missing required files (.onnx, tokens.txt, espeak-ng-data)');
  }

  const assets: TTSAssets = {
    rootDir: modelRoot,
    onnxModelPath: onnxPath,
    tokensPath,
    espeakDataDir,
  };
  await initializeTTSFromAssets(assets);
  try {
    (SherpaTTS as any).enforcePlayback?.();
  } catch {}
  return assets;
};


