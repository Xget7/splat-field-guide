import AVFoundation
import Foundation

// Used only on HybridSpeechOutput's serial worker, including model construction and warmup.
final class KokoroEngine {
  static let sampleRate: Double = 24_000
  private let native: KokoroNative
  private let voice: Data
  private let vocabulary: [String: Int]
  private let frontend: KokoroEnglishPhonemizer
  private let g2p: KokoroEnglishG2P

  init() throws {
    guard let url = Bundle.main.url(forResource: "ReactNativeOnDeviceKokoro", withExtension: "bundle"),
      let bundle = Bundle(url: url), let resources = bundle.resourceURL else {
      throw OnDeviceError(message: "Bundled Kokoro resources are missing")
    }
    let config = try JSONSerialization.jsonObject(
      with: Data(contentsOf: resources.appendingPathComponent("config.json"))) as? [String: Any]
    guard let vocabulary = config?["vocab"] as? [String: Int], !vocabulary.isEmpty else {
      throw OnDeviceError(message: "Kokoro vocabulary is invalid")
    }
    self.vocabulary = vocabulary
    voice = try Data(contentsOf: resources.appendingPathComponent("af_heart.bin"))
    guard voice.count == 510 * 256 * MemoryLayout<Float>.size else {
      throw OnDeviceError(message: "Kokoro af_heart embedding is invalid")
    }
    let lexicon = try JSONDecoder().decode(Lexicon.self,
      from: Data(contentsOf: resources.appendingPathComponent("us_lexicon_cache.json")))
    frontend = KokoroEnglishPhonemizer(wordToPhonemes: lexicon.lower,
      caseSensitiveWordToPhonemes: lexicon.caseSensitive,
      allowedPunctuation: Set(",.!?;:…".filter { vocabulary[String($0)] != nil }))
    g2p = KokoroEnglishG2P(directory: resources)
    native = try KokoroNative(modelPath: resources.appendingPathComponent("model_quantized.onnx").path)
  }

  func synthesize(_ text: String, cancellation: KokoroCancellation) throws -> AVAudioPCMBuffer {
    let phonemes = try frontend.phonemize(EnglishTextNormalizer.normalize(text)) {
      if cancellation.isCancelled { throw OnDeviceError(message: "Kokoro synthesis cancelled") }
      return try self.g2p.phonemize(word: $0, shouldCancel: { cancellation.isCancelled })
    }
    let tokens = phonemes.compactMap { vocabulary[String($0)] }
    guard !tokens.isEmpty, tokens.count <= 510 else {
      throw OnDeviceError(message: "Kokoro sentence exceeds its phoneme limit")
    }
    let styleIndex = min(tokens.count - 1, 509)
    let style = voice.subdata(in: (styleIndex * 1024)..<((styleIndex + 1) * 1024))
    let audio = try native.synthesizeTokens(([0] + tokens + [0]).map { NSNumber(value: $0) },
      style: style, cancellation: cancellation)
    let frames = audio.count / MemoryLayout<Float>.size
    guard let format = AVAudioFormat(standardFormatWithSampleRate: Self.sampleRate, channels: 1),
      let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)),
      let samples = buffer.floatChannelData?[0] else {
      throw OnDeviceError(message: "Unable to allocate Kokoro audio")
    }
    buffer.frameLength = AVAudioFrameCount(frames)
    audio.copyBytes(to: UnsafeMutableRawBufferPointer(start: samples, count: audio.count))
    for i in 0..<frames where !samples[i].isFinite {
      throw OnDeviceError(message: "Kokoro returned invalid samples")
    }
    return buffer
  }

  private struct Lexicon: Decodable {
    let lower: [String: [String]]
    let caseSensitive: [String: [String]]
  }
}
