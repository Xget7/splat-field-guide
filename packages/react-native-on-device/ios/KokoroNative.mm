#import "KokoroNative.h"
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdocumentation"
#include <onnxruntime/onnxruntime_cxx_api.h>
#pragma clang diagnostic pop
#include <atomic>
#include <memory>
#include <mutex>
#include <vector>

static void KokoroError(NSError **error, const char *message) {
  if (error) {
    *error = [NSError errorWithDomain:@"dev.splatfieldguide.kokoro" code:1
                             userInfo:@{NSLocalizedDescriptionKey: @(message)}];
  }
}

@implementation KokoroCancellation {
  std::unique_ptr<Ort::RunOptions> _options;
  std::atomic_bool _cancelled;
  std::mutex _mutex;
}
- (BOOL)isCancelled { return _cancelled.load(); }
- (void)cancel {
  std::lock_guard<std::mutex> lock(_mutex);
  _cancelled = true;
  if (_options) {
    auto status = Ort::GetApi().RunOptionsSetTerminate(*_options);
    if (status) Ort::GetApi().ReleaseStatus(status);
  }
}
- (Ort::RunOptions &)options {
  std::lock_guard<std::mutex> lock(_mutex);
  if (!_options) _options = std::make_unique<Ort::RunOptions>();
  if (_cancelled) _options->SetTerminate();
  return *_options;
}
@end

@implementation KokoroNative {
  std::unique_ptr<Ort::Env> _env;
  std::unique_ptr<Ort::Session> _session;
}
- (instancetype)initWithModelPath:(NSString *)path error:(NSError **)error {
  self = [super init];
  if (!self) return nil;
  try {
    _env = std::make_unique<Ort::Env>(ORT_LOGGING_LEVEL_ERROR, "FieldGuideKokoro");
    Ort::SessionOptions options;
    options.SetIntraOpNumThreads(2);
    options.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
    // CPU avoids the Kokoro CoreML MPSGraph crash and leaves Metal free for the viewer.
    options.AddConfigEntry("session.intra_op.allow_spinning", "0");
    _session = std::make_unique<Ort::Session>(*_env, path.fileSystemRepresentation, options);
    return self;
  } catch (const std::exception &exception) {
    KokoroError(error, exception.what());
    return nil;
  }
}
- (NSData *)synthesizeTokens:(NSArray<NSNumber *> *)tokens style:(NSData *)style
               cancellation:(KokoroCancellation *)cancellation error:(NSError **)error {
  try {
    if (tokens.count < 3 || tokens.count > 512 || style.length != 256 * sizeof(float)) {
      throw std::runtime_error("Invalid Kokoro input or voice embedding");
    }
    std::vector<int64_t> ids;
    for (NSNumber *token in tokens) ids.push_back(token.longLongValue);
    std::vector<float> voice(256);
    memcpy(voice.data(), style.bytes, style.length);
    float speed = 1.0f;
    const int64_t tokenShape[] = {1, static_cast<int64_t>(ids.size())};
    const int64_t styleShape[] = {1, 256};
    const int64_t speedShape[] = {1};
    auto memory = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
    std::vector<Ort::Value> inputs;
    inputs.push_back(Ort::Value::CreateTensor<int64_t>(memory, ids.data(), ids.size(), tokenShape, 2));
    inputs.push_back(Ort::Value::CreateTensor<float>(memory, voice.data(), voice.size(), styleShape, 2));
    inputs.push_back(Ort::Value::CreateTensor<float>(memory, &speed, 1, speedShape, 1));
    const char *inputNames[] = {"input_ids", "style", "speed"};
    const char *outputNames[] = {"waveform"};
    Ort::AllocatorWithDefaultOptions allocator;
    // Exporters use either waveform or audio as their output name.
    auto outputName = _session->GetOutputNameAllocated(0, allocator);
    outputNames[0] = outputName.get();
    auto outputs = _session->Run([cancellation options], inputNames, inputs.data(), 3, outputNames, 1);
    const auto info = outputs[0].GetTensorTypeAndShapeInfo();
    if (info.GetElementType() != ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT) {
      throw std::runtime_error("Kokoro returned a non-float waveform");
    }
    const size_t count = info.GetElementCount();
    if (count == 0 || count > 24000 * 120) throw std::runtime_error("Invalid Kokoro waveform length");
    return [NSData dataWithBytes:outputs[0].GetTensorData<float>() length:count * sizeof(float)];
  } catch (const std::exception &exception) {
    KokoroError(error, exception.what());
    return nil;
  }
}
@end
