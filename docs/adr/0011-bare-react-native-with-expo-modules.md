# Bare React Native, with individual Expo modules

Status: proposed

The app compiles the engine from source, so it needs full control of the native projects.
It is a bare React Native 0.87 app that installs only the Expo modules it uses, such as file system and speech recognition.

**Pros**
- Native build settings for C++, Metal and Vulkan stay in our hands.
- Well-maintained modules for files and speech without writing them.

**Cons**
- No Expo managed workflow conveniences such as cloud builds or config plugins by default.
