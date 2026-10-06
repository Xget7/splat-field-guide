#include <jni.h>
#include <fbjni/fbjni.h>
#include <DefaultComponentsRegistry.h>
#include "reactnativesplatOnLoad.hpp"
#include "views/HybridSplatViewComponent.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, [] {
    margelo::nitro::splat::registerAllNatives();
    // Keep the app's descriptors and add the view's typed props and state.
    auto previous = facebook::react::DefaultComponentsRegistry::registerComponentDescriptorsFromEntryPoint;
    facebook::react::DefaultComponentsRegistry::registerComponentDescriptorsFromEntryPoint =
        [previous](auto registry) {
          if (previous) previous(registry);
          registry->add(facebook::react::concreteComponentDescriptorProvider<
              margelo::nitro::splat::views::HybridSplatViewComponentDescriptor>());
        };
  });
}
