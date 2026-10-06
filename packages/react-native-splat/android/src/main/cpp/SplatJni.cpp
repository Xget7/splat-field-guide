#include <jni.h>
#include <android/native_window_jni.h>
#include <android/log.h>
#include <atomic>
#include <cmath>
#include <algorithm>
#include <memory>
#include <mutex>
#include <unordered_map>
#include <vector>
#include "splatkit/sfg_vulkan.h"
#include "splatkit/sfg_platform.h"

namespace {
struct Engine {
  JavaVM* javaVm = nullptr;
  sfg_engine* handle = nullptr;
  jobject owner = nullptr;
  std::atomic<bool> detached{false};
  ~Engine() {
    if (handle) sfg_destroy(handle);
    JNIEnv* env = nullptr;
    bool attached = javaVm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK;
    if (attached) javaVm->AttachCurrentThread(&env, nullptr);
    env->DeleteGlobalRef(owner);
    if (attached) javaVm->DetachCurrentThread();
  }
};
std::mutex registryMutex;
std::unordered_map<jlong, std::shared_ptr<Engine>> engines;
jlong nextId = 0;
std::shared_ptr<Engine> engine(jlong id) {
  std::lock_guard<std::mutex> lock(registryMutex);
  auto it = engines.find(id);
  return it == engines.end() ? nullptr : it->second;
}
void event(void* context, sfg_event code, const char* message, uint32_t count) {
  auto& state = *static_cast<Engine*>(context);
  if (state.detached) return;
  JNIEnv* env = nullptr;
  bool attached = state.javaVm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK;
  if (attached) state.javaVm->AttachCurrentThread(&env, nullptr);
  jclass cls = env->GetObjectClass(state.owner);
  jmethodID method = env->GetMethodID(cls, "nativeEvent", "(ILjava/lang/String;I)V");
  jstring text = env->NewStringUTF(message);
  env->CallVoidMethod(state.owner, method, static_cast<jint>(code), text, static_cast<jint>(count));
  env->DeleteLocalRef(text);
  env->DeleteLocalRef(cls);
  if (attached) state.javaVm->DetachCurrentThread();
}
std::vector<float> floats(JNIEnv* env, jfloatArray values) {
  std::vector<float> result(env->GetArrayLength(values));
  env->GetFloatArrayRegion(values, 0, result.size(), result.data());
  return result;
}
}
#define JNI_METHOD(name) Java_com_margelo_nitro_splat_SplatEngine_##name
extern "C" {
JNIEXPORT jlong JNICALL JNI_METHOD(create)(JNIEnv* env, jobject, jobject owner) {
  auto state = std::make_shared<Engine>();
  env->GetJavaVM(&state->javaVm);
  state->owner = env->NewGlobalRef(owner);
  state->handle = sfg_vulkan_create();
  if (!state->handle) return 0;
  sfg_set_event_callback(state->handle, event, state.get());
  std::lock_guard<std::mutex> lock(registryMutex);
  jlong id = ++nextId;
  engines[id] = std::move(state);
  return id;
}
JNIEXPORT void JNICALL JNI_METHOD(destroy)(JNIEnv*, jobject, jlong id) {
  auto state = engine(id);
  if (!state) return;
  state->detached = true;
  sfg_set_event_callback(state->handle, nullptr, nullptr);
  sfg_begin_load(state->handle);
  std::lock_guard<std::mutex> lock(registryMutex);
  engines.erase(id);
}
JNIEXPORT void JNICALL JNI_METHOD(surface)(JNIEnv* env, jobject, jlong id, jobject surface) {
  auto state = engine(id); if (!state) return;
  ANativeWindow* window = surface ? ANativeWindow_fromSurface(env, surface) : nullptr;
  sfg_vulkan_set_window(state->handle, window);
  if (window) ANativeWindow_release(window);
}
JNIEXPORT void JNICALL JNI_METHOD(resize)(JNIEnv*, jobject, jlong id, jint w, jint h) {
  auto state = engine(id); if (state) sfg_vulkan_resize(state->handle, w, h);
}
JNIEXPORT jlong JNICALL JNI_METHOD(beginLoad)(JNIEnv*, jobject, jlong id) {
  auto state = engine(id); return state ? sfg_begin_load(state->handle) : 0;
}
JNIEXPORT void JNICALL JNI_METHOD(load)(JNIEnv* env, jobject, jlong id, jlong request,
                                       jstring splatPath, jstring labelsPath) {
  auto state = engine(id); if (!state) return;
  const char* cloud = env->GetStringUTFChars(splatPath, nullptr);
  const char* labels = env->GetStringUTFChars(labelsPath, nullptr);
  sfg_load_request(state->handle, request, cloud, *labels ? labels : nullptr);
  env->ReleaseStringUTFChars(splatPath, cloud);
  env->ReleaseStringUTFChars(labelsPath, labels);
}
JNIEXPORT jboolean JNICALL JNI_METHOD(draw)(JNIEnv*, jobject, jlong id, jlong time) {
  auto state = engine(id); if (!state) return false;
  sfg_draw(state->handle, time);
  return sfg_needs_frame(state->handle);
}
JNIEXPORT void JNICALL JNI_METHOD(orbit)(JNIEnv*, jobject, jlong id, jfloat x, jfloat y) {
  auto state = engine(id); if (state) sfg_orbit(state->handle, x, y);
}
JNIEXPORT void JNICALL JNI_METHOD(dolly)(JNIEnv*, jobject, jlong id, jfloat factor) {
  auto state = engine(id); if (state) sfg_dolly(state->handle, factor);
}
JNIEXPORT void JNICALL JNI_METHOD(frame)(JNIEnv* env, jobject, jlong id, jfloatArray box,
                                        jfloat seconds, jfloatArray from) {
  auto state = engine(id); if (!state) return;
  auto b = floats(env, box);
  if (b.size() != 6) return;
  sfg_bounds bounds{{b[0],b[1],b[2]}, {b[3],b[4],b[5]}};
  auto d = from ? floats(env, from) : std::vector<float>{};
  sfg_view_direction direction{d.size() == 2 ? d[0] : 0, d.size() == 2 ? d[1] : 0};
  sfg_frame(state->handle, &bounds, seconds, d.size() == 2 ? &direction : nullptr);
}
JNIEXPORT void JNICALL JNI_METHOD(limits)(JNIEnv* env, jobject, jlong id, jfloatArray values) {
  auto state = engine(id); if (!state) return;
  if (!values) { sfg_set_camera_limits(state->handle, nullptr); return; }
  auto v = floats(env, values); if (v.size() != 6) return;
  sfg_camera_limits limits{v[0],v[1],v[2],v[3],v[4],v[5]};
  sfg_set_camera_limits(state->handle, &limits);
}
JNIEXPORT void JNICALL JNI_METHOD(highlight)(JNIEnv* env, jobject, jlong id, jbyteArray values) {
  auto state = engine(id); if (!state) return;
  std::vector<uint8_t> labels(env->GetArrayLength(values));
  env->GetByteArrayRegion(values, 0, labels.size(), reinterpret_cast<jbyte*>(labels.data()));
  sfg_set_highlight(state->handle, labels.data(), labels.size());
}
JNIEXPORT void JNICALL JNI_METHOD(reveal)(JNIEnv*, jobject, jlong id, jfloat seconds) {
  auto state = engine(id); if (state) sfg_set_reveal(state->handle, seconds);
}
JNIEXPORT jint JNICALL JNI_METHOD(pick)(JNIEnv*, jobject, jlong id, jfloat x, jfloat y) {
  auto state = engine(id); return state ? sfg_pick(state->handle, x, y) : 0;
}
JNIEXPORT jint JNICALL JNI_METHOD(project)(JNIEnv* env, jobject, jlong id, jobject points, jobject out) {
  auto state = engine(id);
  jlong bytes = env->GetDirectBufferCapacity(points);
  jlong outBytes = env->GetDirectBufferCapacity(out);
  auto* source = static_cast<float*>(env->GetDirectBufferAddress(points));
  auto* target = static_cast<float*>(env->GetDirectBufferAddress(out));
  if (!source || !target || bytes < 0 || bytes % 12 || outBytes < bytes / 12 * 8) return 0;
  if (!state) { std::fill(target, target + bytes / 12 * 2, NAN); return 0; }
  return sfg_project(state->handle, source, bytes / 12, target);
}
JNIEXPORT jfloatArray JNICALL JNI_METHOD(direction)(JNIEnv* env, jobject, jlong id) {
  auto state = engine(id); sfg_view_direction direction{};
  if (!state || !sfg_drawn_direction(state->handle, &direction)) return nullptr;
  auto result = env->NewFloatArray(2);
  float values[]{direction.azimuth,direction.elevation};
  env->SetFloatArrayRegion(result,0,2,values);
  return result;
}
JNIEXPORT jdouble JNICALL JNI_METHOD(gpuMillis)(JNIEnv*, jobject, jlong id) {
  auto state = engine(id);
  return state ? splatkit::engineOf(state->handle).renderer().lastGpuMillis() : 0;
}
}
