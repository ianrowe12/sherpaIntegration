import AudioRecord from 'react-native-audio-record';
import * as RNFS from '@dr.pogodin/react-native-fs';

const SAMPLE_RATE = 16000;
const CHANNELS = 1;

let currentWavFileName: string | null = null;

export type RecordingResult = {
  pcmPath: string;
  wavPath?: string;
};

export async function setupRecorder(): Promise<void> {
  // Create a unique wav filename; library saves into Documents with this name
  const fileName = `rec_${Date.now()}.wav`;
  currentWavFileName = fileName;
  AudioRecord.init({
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    bitsPerSample: 16,
    wavFile: fileName,
  });
}

export async function startRecording(maxMs = 30000): Promise<void> {
  await setupRecorder();
  // attach a data listener to avoid warning logs (no-op)
  AudioRecord.on('data', () => {});
  await AudioRecord.start();
  // Safety stop after maxMs
  setTimeout(() => {
    stopRecording().catch(() => {});
  }, maxMs);
}

export async function stopRecording(): Promise<RecordingResult> {
  const audioBuffer = await AudioRecord.stop(); // returns base64 PCM data
  const dir = `${RNFS.DocumentDirectoryPath}/recordings`;
  await RNFS.mkdir(dir);
  const pcmPath = `${dir}/rec_${Date.now()}.pcm`;
  await RNFS.writeFile(pcmPath, audioBuffer, 'base64');
  // Try to resolve the wav file saved by native lib
  const wavPathCandidate = currentWavFileName
    ? `${RNFS.DocumentDirectoryPath}/${currentWavFileName}`
    : undefined;
  currentWavFileName = null;
  if (wavPathCandidate) {
    try {
      const exists = await RNFS.exists(wavPathCandidate);
      if (exists) {
        return {pcmPath, wavPath: wavPathCandidate};
      }
    } catch {}
  }
  return {pcmPath};
}


