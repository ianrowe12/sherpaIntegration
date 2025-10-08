package com.pocketpal

import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.k2fsa.sherpa.onnx.*
import android.util.Base64
import java.nio.ByteBuffer
import java.nio.ByteOrder
import android.content.res.AssetManager
import kotlin.concurrent.thread
import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import org.json.JSONObject
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder

class ModelLoader(private val context: Context) {

    /**
     * Copies a file from the assets directory to the internal storage.
     *
     * @param assetPath The path to the asset in the assets directory.
     * @param outputFileName The name of the file in internal storage.
     * @return The absolute path to the copied file.
     * @throws IOException If an error occurs during file operations.
     */
    @Throws(IOException::class)
    fun loadModelFromAssets(assetPath: String, outputFileName: String): String {
        // Open the asset as an InputStream
        val assetManager = context.assets
        val inputStream = assetManager.open(assetPath)

        // Create a file in the app's internal storage
        val outFile = File(context.filesDir, outputFileName)
        FileOutputStream(outFile).use { output ->
            inputStream.copyTo(output)
        }

        // Close the InputStream
        inputStream.close()

        // Return the absolute path to the copied file
        return outFile.absolutePath
    }

    /**
     * Copies an entire directory from the assets to internal storage.
     *
     * @param assetDir The directory path in the assets.
     * @param outputDir The directory path in internal storage.
     * @throws IOException If an error occurs during file operations.
     */
    @Throws(IOException::class)
    fun copyAssetDirectory(assetDir: String, outputDir: File) {
        val assetManager = context.assets
        val files = assetManager.list(assetDir) ?: return

        if (!outputDir.exists()) {
            outputDir.mkdirs()
        }

        for (file in files) {
            val assetPath = if (assetDir.isEmpty()) file else "$assetDir/$file"
            val outFile = File(outputDir, file)

            if (assetManager.list(assetPath)?.isNotEmpty() == true) {
                // It's a directory
                copyAssetDirectory(assetPath, outFile)
            } else {
                // It's a file
                assetManager.open(assetPath).use { inputStream ->
                    FileOutputStream(outFile).use { outputStream ->
                        inputStream.copyTo(outputStream)
                    }
                }
            }
        }
    }
}


class TTSManagerModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private var tts: OfflineTts? = null
    private var realTimeAudioPlayer: AudioPlayer? = null
    private val modelLoader = ModelLoader(reactContext)

    // STT properties
    private var recognizer: OfflineRecognizer? = null
    private var sttStream: OfflineStream? = null
    private var sttSampleRate: Int = 16000
    private var audioRecorder: AudioRecord? = null
    private var recordingThread: Thread? = null
    private var isRecording: Boolean = false

    override fun getName(): String {
        return "TTSManager"
    }

    // Initialize TTS and Audio Player
    @ReactMethod
    fun initializeTTS(sampleRate: Double, channels: Int, modelId: String) {
        // Setup Audio Player
        realTimeAudioPlayer = AudioPlayer(sampleRate.toInt(), channels, object : AudioPlayerDelegate {
            override fun didUpdateVolume(volume: Float) {
                sendVolumeUpdate(volume)
            }
        })

        // Determine model paths based on modelId
        
        // val modelDirAssetPath = "models"
        // val modelDirInternal = reactContext.filesDir
        // modelLoader.copyAssetDirectory(modelDirAssetPath, modelDirInternal)
        // val modelPath = File(modelDirInternal, if (modelId.lowercase() == "male") "en_US-ryan-medium.onnx" else "en_US-hfc_female-medium.onnx").absolutePath
        // val tokensPath = File(modelDirInternal, "tokens.txt").absolutePath
        // val dataDirPath = File(modelDirInternal, "espeak-ng-data").absolutePath // Directory copy handled above

        val jsonObject = JSONObject(modelId)
        val modelPath = jsonObject.getString("modelPath")
        val tokensPath = jsonObject.getString("tokensPath")
        val dataDirPath = jsonObject.getString("dataDirPath")

        // Build OfflineTtsConfig using the helper function
        val config = OfflineTtsConfig(
            model=OfflineTtsModelConfig(
              vits=OfflineTtsVitsModelConfig(
                model=modelPath,
                tokens=tokensPath,
                dataDir=dataDirPath,
              ),
              numThreads=1,
              debug=true,
            )
          )

        // Initialize sherpa-onnx offline TTS
        tts = OfflineTts(config=config)

        // Start the audio player
        realTimeAudioPlayer?.start()
    }

    // Initialize offline speech recognizer
    @ReactMethod
    fun initializeSTT(modelId: String) {
        val jsonObject = JSONObject(modelId)
        val encoder = jsonObject.getString("encoder")
        val decoder = jsonObject.getString("decoder")
        val joiner = jsonObject.getString("joiner")
        val tokens = jsonObject.getString("tokens")
        sttSampleRate = jsonObject.optInt("sampleRate", 16000)

        val modelConfig = OfflineModelConfig(
            transducer = OfflineTransducerModelConfig(
                encoder = encoder,
                decoder = decoder,
                joiner = joiner
            ),
            tokens = tokens,
            numThreads = 1,
            debug = true,
            provider = "cpu"
        )
        val feat = FeatureConfig(sttSampleRate, 80)
        val cfg = OfflineRecognizerConfig(
            featConfig = feat,
            modelConfig = modelConfig,
            decodingMethod = "greedy_search",
            maxActivePaths = 4,
            hotwordsFile = "",
            hotwordsScore = 1.5f,
            ruleFsts = "",
            ruleFars = "",
            blankPenalty = 0.0f
        )
        recognizer = OfflineRecognizer(reactContext.assets, cfg)
    }

    // Begin a recognition session from the microphone
    @ReactMethod
    fun startRecognition() {
        if (isRecording) {
            return
        }
        val rec = recognizer ?: return
        sttStream = rec.createStream()
        val minBuf = AudioRecord.getMinBufferSize(
            sttSampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        audioRecorder = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            sttSampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            minBuf
        )
        audioRecorder?.startRecording()
        isRecording = true
        recordingThread = thread(start = true) {
            val buffer = ShortArray(1024)
            while (isRecording) {
                val read = audioRecorder!!.read(buffer, 0, buffer.size)
                if (read > 0) {
                    val floatSamples = FloatArray(read)
                    for (i in 0 until read) {
                        floatSamples[i] = buffer[i] / 32768.0f
                    }
                    sttStream?.acceptWaveform(floatSamples, sttSampleRate)
                }
            }
        }
    }

    // Feed audio data as base64-encoded PCM16LE
    @ReactMethod
    fun feedAudio(data: String) {
        val stream = sttStream ?: return
        val bytes = Base64.decode(data, Base64.DEFAULT)
        val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        val samples = FloatArray(bytes.size / 2)
        for (i in samples.indices) {
            samples[i] = buf.short.toFloat() / 32768.0f
        }
        stream.acceptWaveform(samples, sttSampleRate)
    }

    // Stop recognition and return the transcription
    @ReactMethod
    fun stopRecognition(promise: Promise) {
        isRecording = false
        recordingThread?.join()
        recordingThread = null
        audioRecorder?.stop()
        audioRecorder?.release()
        audioRecorder = null

        val stream = sttStream
        val rec = recognizer
        if (stream == null || rec == null) {
            promise.reject("NOT_READY", "Recognizer not ready")
            return
        }
        rec.decode(stream)
        val result = rec.getResult(stream)
        stream.release()
        sttStream = null
        promise.resolve(result.text)
    }

    // Release recognizer resources
    @ReactMethod
    fun deinitializeSTT() {
        isRecording = false
        recordingThread?.join()
        recordingThread = null
        audioRecorder?.stop()
        audioRecorder?.release()
        audioRecorder = null
        recognizer?.release()
        recognizer = null
        sttStream = null
    }

    // Generate and Play method exposed to React Native
    @ReactMethod
    fun generateAndPlay(text: String, sid: Int, speed: Double, promise: Promise) {
        val trimmedText = text.trim()
        if (trimmedText.isEmpty()) {
            promise.reject("EMPTY_TEXT", "Input text is empty")
            return
        }

        val sentences = splitText(trimmedText, 15)
            try {
                for (sentence in sentences) {
                    val processedSentence = if (sentence.endsWith(".")) sentence else "$sentence."
                    generateAudio(processedSentence, sid, speed.toFloat())
                }
                // Once done generating and enqueueing all audio, resolve the promise
                promise.resolve("Audio generated and played successfully")
            } catch (e: Exception) {
                promise.reject("GENERATION_ERROR", "Error during audio generation: ${e.message}")
            }
    }

    // Deinitialize method exposed to React Native
    @ReactMethod
    fun deinitialize() {
        realTimeAudioPlayer?.stopPlayer()
        realTimeAudioPlayer = null
        tts?.release()
        tts = null
        deinitializeSTT()
    }

    // Helper: split text into manageable chunks similar to iOS logic
    private fun splitText(text: String, maxWords: Int): List<String> {
        val sentences = mutableListOf<String>()
        val words = text.split("\\s+".toRegex()).filter { it.isNotEmpty() }
        var currentIndex = 0
        val totalWords = words.size

        while (currentIndex < totalWords) {
            val endIndex = (currentIndex + maxWords).coerceAtMost(totalWords)
            var chunk = words.subList(currentIndex, endIndex).joinToString(" ")

            val lastPeriod = chunk.lastIndexOf('.')
            val lastComma = chunk.lastIndexOf(',')

            when {
                lastPeriod != -1 -> {
                    val sentence = chunk.substring(0, lastPeriod + 1).trim()
                    sentences.add(sentence)
                    currentIndex += sentence.split("\\s+".toRegex()).size
                }
                lastComma != -1 -> {
                    val sentence = chunk.substring(0, lastComma + 1).trim()
                    sentences.add(sentence)
                    currentIndex += sentence.split("\\s+".toRegex()).size
                }
                else -> {
                    sentences.add(chunk.trim())
                    currentIndex += maxWords
                }
            }
        }

        return sentences
    }

    private fun generateAudio(text: String, sid: Int, speed: Float) {
        val startTime = System.currentTimeMillis()
        val audio = tts?.generate(text, sid, speed)
        val endTime = System.currentTimeMillis()
        val generationTime = (endTime - startTime) / 1000.0
        println("Time taken for TTS generation: $generationTime seconds")

        if (audio == null) {
            println("Error: TTS was never initialized or audio generation failed")
            return
        }
        realTimeAudioPlayer?.enqueueAudioData(audio.samples, audio.sampleRate)
    }

    private fun sendVolumeUpdate(volume: Float) {
        // Emit the volume to JavaScript
        if (reactContext.hasActiveCatalystInstance()) {
            val params = Arguments.createMap()
            
            params.putDouble("volume", volume.toDouble())
            //println("kislaytest: Volume Update: $volume")
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("VolumeUpdate", params)
        }
    }
}
