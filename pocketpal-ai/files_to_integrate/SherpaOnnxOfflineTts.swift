// TTSManager.swift

import Foundation
import AVFoundation
import React

// Define a protocol for volume updates
protocol AudioPlayerDelegate: AnyObject {
    func didUpdateVolume(_ volume: Float)
}

@objc(TTSManager)
class TTSManager: RCTEventEmitter, AudioPlayerDelegate {
    private var tts: SherpaOnnxOfflineTtsWrapper?
    private var realTimeAudioPlayer: AudioPlayer?
    private var recognizer: SherpaOnnxOfflineRecognizer?
    private var sttSampleRate: Int = 16000
    private var audioEngine: AVAudioEngine?
    private var capturedSamples: [Float] = []
    // Dedicated queues for background work
    private let ttsQueue = DispatchQueue(label: "com.pocketpal.tts.generate", qos: .userInitiated)
    private let methodBgQueue = DispatchQueue(label: "com.pocketpal.tts.method", qos: .userInitiated)
    // Cooperative cancellation
    private var ttsCancelled: Bool = false
    
    override init() {
        super.init()
        // Optionally, initialize AudioPlayer here if needed
    }
    
    // Required for RCTEventEmitter
    override static func requiresMainQueueSetup() -> Bool {
        // Do not force module initialization onto main; dispatch UI-sensitive work explicitly
        return false
    }

    // Execute exported methods on a background queue by default
    override func methodQueue() -> DispatchQueue! {
        return methodBgQueue
    }
    
    // Specify the events that can be emitted
    override func supportedEvents() -> [String]! {
        return ["VolumeUpdate"]
    }
    
    // Initialize TTS and Audio Player
    @objc(initializeTTS:channels:modelId:)
    func initializeTTS(_ sampleRate: Double, channels: Int, modelId: String) {
        // Player/UI objects must be created on main
        DispatchQueue.main.async {
            self.realTimeAudioPlayer = AudioPlayer(sampleRate: sampleRate, channels: AVAudioChannelCount(channels))
            self.realTimeAudioPlayer?.delegate = self // Set delegate to receive volume updates
        }
        // TTS creation is CPU-light; keep off main
        self.tts = createOfflineTts(modelId: modelId)
    }

    // Ensure playback session is active before TTS output (duplex voiceChat route)
    @objc func enforcePlayback() {
        DispatchQueue.main.async {
            let session = AVAudioSession.sharedInstance()
            do {
                try? session.setPreferredInput(nil)
                try session.setCategory(
                    .playAndRecord,
                    mode: .voiceChat,
                    options: [.defaultToSpeaker, .allowBluetooth]
                )
                try session.setActive(true, options: [])
                try session.overrideOutputAudioPort(.speaker)
                self.realTimeAudioPlayer?.ensureEngineRunning()
            } catch {
                print("[SherpaTTS][iOS] enforcePlayback failed: \(error)")
            }
        }
    }

    // Initialize streaming STT
    @objc(initializeSTT:)
    func initializeSTT(_ modelId: String) {
        guard let data = modelId.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        let encoder = json["encoder"] as? String ?? ""
        let decoder = json["decoder"] as? String ?? ""
        let joiner = json["joiner"] as? String ?? ""
        let tokens = json["tokens"] as? String ?? ""
        sttSampleRate = json["sampleRate"] as? Int ?? 16000

        var model = sherpaOnnxOnlineModelConfig(
            tokens: tokens,
            transducer: sherpaOnnxOnlineTransducerModelConfig(
                encoder: encoder,
                decoder: decoder,
                joiner: joiner
            ),
            numThreads: 1,
            provider: "cpu",
            debug: 1,
            modelType: "zipformer"
        )
        let feat = sherpaOnnxFeatureConfig(sampleRate: sttSampleRate, featureDim: 80)
        var cfg = sherpaOnnxOnlineRecognizerConfig(
            featConfig: feat,
            modelConfig: model,
            decodingMethod: "greedy_search"
        )
        recognizer = SherpaOnnxOnlineRecognizer(config: &cfg)
    }

    @objc func startRecognition() {
        DispatchQueue.main.async {
            self.audioEngine = AVAudioEngine()
            self.capturedSamples.removeAll()
            guard let engine = self.audioEngine else { return }
            guard self.recognizer != nil else { return }
            let input = engine.inputNode
            let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: Double(self.sttSampleRate), channels: 1, interleaved: false)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                let count = Int(buffer.frameLength)
                if let data = buffer.floatChannelData?[0] {
                    let samples = Array(UnsafeBufferPointer(start: data, count: count))
                    self.capturedSamples.append(contentsOf: samples)
                }
            }
            engine.prepare()
            try? engine.start()
        }
    }

    @objc func feedAudio(_ data: String) {
        guard let bytes = Data(base64Encoded: data) else { return }
        let count = bytes.count / 2
        var samples = [Float]()
        samples.reserveCapacity(count)
        bytes.withUnsafeBytes { buf in
            for i in 0..<count {
                let val = buf.load(fromByteOffset: i*2, as: Int16.self)
                samples.append(Float(val) / 32768.0)
            }
        }
        capturedSamples.append(contentsOf: samples)
    }

    @objc func stopRecognition(_ resolver: RCTPromiseResolveBlock, rejecter: RCTPromiseRejectBlock) {
        // Tear-down audio input on main to avoid mutating graph from arbitrary threads
        DispatchQueue.main.async {
            self.audioEngine?.inputNode.removeTap(onBus: 0)
            self.audioEngine?.stop()
            self.audioEngine = nil
        }
        guard let rec = recognizer else {
            rejecter("NOT_READY", "Recognizer not ready", nil)
            return
        }
        // Perform decode off main
        let text = rec.decode(samples: capturedSamples, sampleRate: sttSampleRate).text
        capturedSamples.removeAll()
        resolver(text)
    }

    @objc func deinitializeSTT() {
        audioEngine?.stop()
        audioEngine = nil
        recognizer = nil
        capturedSamples.removeAll()
    }

    // Generate audio and play in real-time
    @objc(generateAndPlay:sid:speed:resolver:rejecter:)
    func generateAndPlay(_ text: String, sid: Int, speed: Double, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
        let trimmedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedText.isEmpty else {
            rejecter("EMPTY_TEXT", "Input text is empty", nil)
            return
        }
        guard tts != nil else {
            rejecter("NOT_INITIALIZED", "TTS not initialized", nil)
            return
        }

        let sentences = splitText(trimmedText, maxWords: 15)
        // Reset cancellation and dispatch generation to background serial queue
        ttsCancelled = false
        ttsQueue.async { [weak self] in
            guard let self = self else { return }
            for sentence in sentences {
                if self.ttsCancelled { break }
                let processed = sentence.hasSuffix(".") ? sentence : "\(sentence)."
                self.generateAudio(for: processed, sid: sid, speed: speed)
                if self.ttsCancelled { break }
            }
            resolver("Audio generated and played successfully")
        }
    }

    /// Splits the input text into sentences with a maximum of `maxWords` words.
    /// It prefers to split at a period (.), then a comma (,), and finally forcibly after `maxWords`.
    ///
    /// - Parameters:
    ///   - text: The input text to split.
    ///   - maxWords: The maximum number of words per sentence.
    /// - Returns: An array of sentence strings.
    func splitText(_ text: String, maxWords: Int) -> [String] {
        var sentences: [String] = []
        let words = text.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }
        var currentIndex = 0
        let totalWords = words.count
        
        while currentIndex < totalWords {
            // Determine the range for the current chunk
            let endIndex = min(currentIndex + maxWords, totalWords)
            var chunk = words[currentIndex..<endIndex].joined(separator: " ")
            
            // Search for the last period within the chunk
            if let periodRange = chunk.range(of: ".", options: .backwards) {
                let sentence = String(chunk[..<periodRange.upperBound]).trimmingCharacters(in: .whitespacesAndNewlines)
                sentences.append(sentence)
                currentIndex += sentence.components(separatedBy: .whitespacesAndNewlines).count
            }
            // If no period, search for the last comma
            else if let commaRange = chunk.range(of: ",", options: .backwards) {
                let sentence = String(chunk[..<commaRange.upperBound]).trimmingCharacters(in: .whitespacesAndNewlines)
                sentences.append(sentence)
                currentIndex += sentence.components(separatedBy: .whitespacesAndNewlines).count
            }
            // If neither, forcibly break after maxWords
            else {
                sentences.append(chunk.trimmingCharacters(in: .whitespacesAndNewlines))
                currentIndex += maxWords
            }
        }
        
        return sentences
    }
    
    // Helper function to generate and play audio
    private func generateAudio(for text: String, sid: Int, speed: Double) {
        // This runs on ttsQueue; avoid main-thread blocking
        print("[SherpaTTS][iOS] Generating audio for: \(text)")
        let startTime = Date()
        guard let audio = tts?.generate(text: text, sid: sid, speed: Float(speed)) else {
            print("[SherpaTTS][iOS] Error: TTS was never initialised")
            return
        }
        let generationTime = Date().timeIntervalSince(startTime)
        print("[SherpaTTS][iOS] TTS generation took: \(generationTime)s")
        // Playback scheduling must occur on main
        DispatchQueue.main.async {
            self.realTimeAudioPlayer?.playAudioData(from: audio)
        }
    }
    
    // Non-blocking, idempotent stop for barge-in
    @objc func stop() {
        // Set cancellation flag and interrupt playback quickly
        ttsCancelled = true
        DispatchQueue.main.async {
            if let player = self.realTimeAudioPlayer {
                // Prefer soft interrupt if available; otherwise stop
                if player.responds(to: Selector(("interrupt"))) {
                    player.perform(Selector(("interrupt")))
                } else {
                    player.stop()
                }
            }
        }
    }

    // Clean up resources
    @objc func deinitialize() {
        DispatchQueue.main.async {
            self.realTimeAudioPlayer?.stop()
            self.realTimeAudioPlayer = nil
        }
        self.tts = nil
        deinitializeSTT()
    }
    
    // MARK: - AudioPlayerDelegate Method
    
    func didUpdateVolume(_ volume: Float) {
        // Emit the volume to JavaScript
        sendEvent(withName: "VolumeUpdate", body: ["volume": volume])
    }
}
