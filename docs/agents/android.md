# Android

Use JDK 17 and the SDK/NDK in [app setup](../../apps/field-guide/README.md#android).
Keep Gradle's user home, build outputs and any AVD under the worktree, in `.work/`.
The shared C++ tests and the app/package [checks](checks.md) cover the common interfaces.

## Build

Build arm64-v8a with at most three workers, from root:

```sh
JAVA_HOME=$(/usr/libexec/java_home -v 17) GRADLE_USER_HOME="$PWD/.work/gradle" nice -n 19 apps/field-guide/android/gradlew -p apps/field-guide/android :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --max-workers=3
```

## Emulator

Create a tablet AVD named `FieldGuide` under `.work/avd` from the API 36 arm64 image with 6 GB RAM, then run it headless on the host GPU:

```sh
ANDROID_AVD_HOME="$PWD/.work/avd" ANDROID_USER_HOME="$PWD/.work/android-user" nice -n 19 "$ANDROID_HOME/emulator/emulator" -avd FieldGuide -no-window -no-audio -no-snapshot -gpu host
```

Use Argent to install, launch and inspect the viewer; keep paid instructor requests off with fakes or device networking disabled.
For Debug, start an owned Metro port and reverse it with `adb -s <serial> reverse tcp:<port> tcp:<port>`; leave other sessions' servers alone.

## Finish

Record screenshots and the APK, then delete the temporary builds and the private Gradle cache.
Stop the scoped device servers and the owned Metro process, and shut down the owned emulator with `adb -s <serial> emu kill`.
