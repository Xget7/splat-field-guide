// Adapted from FluidAudio, Apache-2.0, revision 2a2e382f80e07720fb511183de1731813a90a39a.
// See LICENSES/FluidAudio.txt and KokoroFrontend/README.md.
import CoreML
import Foundation

/// CoreML grapheme-to-phoneme converter confined to KokoroEngine's serial worker.
/// Uses a small BART encoder-decoder model to convert English words to IPA phonemes.
final class KokoroEnglishG2P {
    enum G2PError: Error, LocalizedError {
        case vocabLoadFailed(String)
        case modelLoadFailed(String)
        case encoderPredictionFailed
        case decoderPredictionFailed

        var errorDescription: String? {
            switch self {
            case .vocabLoadFailed(let detail):
                return "Failed to load G2P \("g2p_vocab.json"): \(detail)"
            case .modelLoadFailed(let detail):
                return "Failed to load G2P CoreML model: \(detail)"
            case .encoderPredictionFailed:
                return "G2P encoder prediction failed."
            case .decoderPredictionFailed:
                return "G2P decoder prediction failed."
            }
        }
    }

    private let directory: URL
    private let logger = KokoroFrontendLog()

    // Vocab tables (loaded once)
    private var graphemeToId: [Character: Int]?
    private var idToPhoneme: [Int: String]?
    private var bosTokenId: Int = 1
    private var eosTokenId: Int = 2
    private var unkTokenId: Int = 3

    // CoreML models (lazy-loaded)
    private var encoder: MLModel?
    private var decoder: MLModel?

    init(directory: URL) { self.directory = directory }

    func phonemize(word: String, shouldCancel: () -> Bool = { false }) throws -> [String]? {
        guard word.count <= 62 else { throw OnDeviceError(message: "Word exceeds G2P limit") }
        try loadIfNeeded()

        guard let graphemeToId, let idToPhoneme, let encoder, let decoder else {
            return nil
        }

        // Encode: [BOS] + grapheme IDs + [EOS]
        var inputIds: [Int32] = [Int32(bosTokenId)]
        for ch in word {
            inputIds.append(Int32(graphemeToId[ch] ?? unkTokenId))
        }
        inputIds.append(Int32(eosTokenId))

        let encLen = inputIds.count

        // Build encoder input MLMultiArray
        let encoderInput = try MLMultiArray(shape: [1, NSNumber(value: encLen)], dataType: .int32)
        for i in 0..<encLen {
            encoderInput[[0, i] as [NSNumber]] = NSNumber(value: inputIds[i])
        }

        // Run encoder
        let encoderProvider = try MLDictionaryFeatureProvider(
            dictionary: ["input_ids": MLFeatureValue(multiArray: encoderInput)]
        )
        guard let encoderOutput = try? encoder.prediction(from: encoderProvider),
            let encoderHidden = encoderOutput.featureValue(for: "encoder_hidden_states")?.multiArrayValue
        else {
            throw G2PError.encoderPredictionFailed
        }

        // Greedy decode loop
        let maxSteps = 64
        var decoderIds: [Int32] = [Int32(bosTokenId)]

        for _ in 0..<maxSteps {
            if shouldCancel() { throw OnDeviceError(message: "G2P cancelled") }
            let decLen = decoderIds.count

            // decoder_input_ids
            let decInput = try MLMultiArray(shape: [1, NSNumber(value: decLen)], dataType: .int32)
            for i in 0..<decLen {
                decInput[[0, i] as [NSNumber]] = NSNumber(value: decoderIds[i])
            }

            // position_ids (BART offset = 2)
            let posIds = try MLMultiArray(shape: [1, NSNumber(value: decLen)], dataType: .int32)
            for i in 0..<decLen {
                posIds[[0, i] as [NSNumber]] = NSNumber(value: Int32(i + 2))
            }

            // causal_mask: upper triangular with -1e4
            let mask = try MLMultiArray(
                shape: [1, NSNumber(value: decLen), NSNumber(value: decLen)], dataType: .float32)
            for i in 0..<decLen {
                for j in 0..<decLen {
                    let val: Float = j > i ? -1e4 : 0
                    mask[[0, i, j] as [NSNumber]] = NSNumber(value: val)
                }
            }

            let decoderProvider = try MLDictionaryFeatureProvider(
                dictionary: [
                    "decoder_input_ids": MLFeatureValue(multiArray: decInput),
                    "encoder_hidden_states": MLFeatureValue(multiArray: encoderHidden),
                    "position_ids": MLFeatureValue(multiArray: posIds),
                    "causal_mask": MLFeatureValue(multiArray: mask),
                ]
            )

            guard let decoderOutput = try? decoder.prediction(from: decoderProvider),
                let logits = decoderOutput.featureValue(for: "logits")?.multiArrayValue
            else {
                throw G2PError.decoderPredictionFailed
            }

            // Argmax of last position's logits
            guard let lastDimension = logits.shape.last else { throw G2PError.decoderPredictionFailed }
            let vocabSize = lastDimension.intValue
            let lastPos = decLen - 1
            var bestId = 0
            var bestVal: Float = -Float.infinity
            for v in 0..<vocabSize {
                let val = logits[[0, lastPos, v] as [NSNumber]].floatValue
                if val > bestVal {
                    bestVal = val
                    bestId = v
                }
            }

            if bestId == eosTokenId { break }
            decoderIds.append(Int32(bestId))
        }

        // Convert token IDs to phoneme string, skipping special tokens
        let specialTokens: Set<Int> = [0, bosTokenId, eosTokenId, unkTokenId]
        var phonemes: [String] = []
        for id in decoderIds {
            let intId = Int(id)
            if specialTokens.contains(intId) { continue }
            if let ph = idToPhoneme[intId] {
                phonemes.append(ph)
            }
        }

        return phonemes.isEmpty ? nil : phonemes
    }

    // MARK: - Private

    private func loadIfNeeded() throws {
        if graphemeToId != nil && encoder != nil && decoder != nil { return }

        let kokoroDir = directory

        // Load g2p_vocab.json from bundled resources
        let vocabURL = kokoroDir.appendingPathComponent("g2p_vocab.json")
        guard FileManager.default.fileExists(atPath: vocabURL.path) else {
            throw G2PError.vocabLoadFailed("\("g2p_vocab.json") not found at \(vocabURL.path)")
        }

        let vocabData = try Data(contentsOf: vocabURL)
        guard let vocab = try JSONSerialization.jsonObject(with: vocabData) as? [String: Any],
            let g2id = vocab["grapheme_to_id"] as? [String: Int],
            let id2ph = vocab["id_to_phoneme"] as? [String: String]
        else {
            throw G2PError.vocabLoadFailed("invalid JSON structure")
        }

        var gMap: [Character: Int] = [:]
        for (key, val) in g2id {
            if let ch = key.first, key.count == 1 {
                gMap[ch] = val
            }
        }
        graphemeToId = gMap

        var pMap: [Int: String] = [:]
        for (key, val) in id2ph {
            if let intKey = Int(key) {
                pMap[intKey] = val
            }
        }
        idToPhoneme = pMap

        if let bos = vocab["bos_token_id"] as? Int { bosTokenId = bos }
        if let eos = vocab["eos_token_id"] as? Int { eosTokenId = eos }
        if let unk = vocab["unk_token_id"] as? Int { unkTokenId = unk }

        logger.info("Loaded G2P vocab (\(gMap.count) graphemes, \(pMap.count) phonemes)")

        // Load CoreML models from bundled resources
        let encoderURL = kokoroDir.appendingPathComponent("G2PEncoder.mlmodelc")
        guard FileManager.default.fileExists(atPath: encoderURL.path) else {
            throw G2PError.modelLoadFailed("\("G2PEncoder.mlmodelc") not found at \(encoderURL.path)")
        }
        let decoderURL = kokoroDir.appendingPathComponent("G2PDecoder.mlmodelc")
        guard FileManager.default.fileExists(atPath: decoderURL.path) else {
            throw G2PError.modelLoadFailed("\("G2PDecoder.mlmodelc") not found at \(decoderURL.path)")
        }

        let config = MLModelConfiguration()
        config.computeUnits = .cpuOnly

        encoder = try MLModel(contentsOf: encoderURL, configuration: config)
        decoder = try MLModel(contentsOf: decoderURL, configuration: config)

        logger.info("Loaded G2P CoreML models")
    }
}
