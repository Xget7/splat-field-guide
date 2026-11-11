import { Platform } from 'react-native';
import {
  AudioContext,
  AudioManager,
  AudioRecorder,
} from 'react-native-audio-api';
import type { KokoroTtsChunk } from 'react-native-executorch';

export type AudioOwner = 'local' | 'remote';
const INPUT_RATE = 16000;
const INPUT_FRAMES = 1600;
const WORD_POLL_MS = 30;

/** One voice-processing session owns both microphone and output, including online audio. */
export function createAudio() {
  let context: AudioContext | null = null;
  let recorder: AudioRecorder | null = null;
  let owner: AudioOwner | null = null;
  let opening: Promise<AudioContext> | null = null;
  let closing: Promise<unknown> = Promise.resolve();
  const inputGeneration = { local: 0, remote: 0 };
  const outputGeneration = { local: 0, remote: 0 };
  let nextStart = 0;
  let playedSeconds = 0;
  let interrupted: ((reason: string) => void) | null = null;
  const playing = new Set<{ stop(error?: Error): void }>();
  let timeline: { start: number; duration: number }[] = [];
  const listeners: { remove(): void }[] = [];

  async function open(requested: AudioOwner) {
    await closing.catch(() => {});
    if (owner !== null && owner !== requested) {
      throw new Error('Audio is already in use');
    }
    owner = requested;
    if (context) {
      return context;
    }
    if (opening) {
      return opening;
    }
    opening = (async () => {
      AudioManager.setSystemOptions({
        ios: {
          category: 'playAndRecord',
          mode: 'voiceChat',
          options: ['defaultToSpeaker', 'allowBluetoothHFP'],
        },
        android:
          Platform.OS === 'android' && Number(Platform.Version) >= 31
            ? { mode: 'inCommunication', communicationDevice: 'speaker' }
            : {},
      });
      await AudioManager.setAudioSessionActivity(true);
      const created = new AudioContext({
        sampleRate: 24000,
        androidOutputProfile: 'voiceCommunication',
      });
      context = created;
      await created.resume();
      AudioManager.observeAudioInterruptions(true);
      listeners.push(
        AudioManager.addSystemEventListener('interruption', event => {
          if (event.type === 'began') {
            lose('Audio session interrupted');
          }
        }),
      );
      listeners.push(
        AudioManager.addSystemEventListener('routeChange', event => {
          if (
            event.reason === 'OldDeviceUnavailable' ||
            event.reason === 'NoSuitableRouteForCategory'
          ) {
            lose('Audio session interrupted');
          }
        }),
      );
      return created;
    })();
    try {
      return await opening;
    } catch (error) {
      owner = null;
      closeIfIdle();
      throw error;
    } finally {
      opening = null;
    }
  }
  function closeIfIdle(requested?: AudioOwner) {
    if (requested && owner !== requested) {
      return;
    }
    if (recorder || playing.size > 0) {
      return;
    }
    const previous = context;
    context = null;
    owner = null;
    interrupted = null;
    listeners.splice(0).forEach(listener => listener.remove());
    if (previous) {
      closing = closing
        .catch(() => {})
        .then(async () => {
          try {
            await previous.close();
          } finally {
            AudioManager.observeAudioInterruptions(false);
            await AudioManager.setAudioSessionActivity(false);
          }
        });
    }
  }
  function lose(reason: string) {
    const notify = interrupted;
    stopInput();
    stopOutput(undefined, new Error(reason));
    notify?.(reason);
  }
  function stopOutput(requested?: AudioOwner, error?: Error) {
    if (requested) {
      outputGeneration[requested]++;
    } else {
      outputGeneration.local++;
      outputGeneration.remote++;
    }
    if (requested && owner !== requested) {
      return;
    }
    [...playing].forEach(item => item.stop(error));
    nextStart = 0;
    timeline = [];
    playedSeconds = 0;
    closeIfIdle();
  }
  function stopInput(requested?: AudioOwner) {
    if (requested) {
      inputGeneration[requested]++;
    } else {
      inputGeneration.local++;
      inputGeneration.remote++;
    }
    if (requested && owner !== requested) {
      return;
    }
    const previous = recorder;
    recorder = null;
    interrupted = null;
    if (previous) {
      previous.clearOnAudioReady();
      previous.clearOnError();
      // The next session waits until the old recorder has released the microphone.
      closing = closing.catch(() => {}).then(() => previous.stop());
    }
    closeIfIdle();
  }
  async function record(
    requested: AudioOwner,
    samples: (pcm: Float32Array) => void,
    level: (amplitude: number) => void,
    stopped: (reason: string) => void,
  ) {
    if (recorder) {
      throw new Error('Microphone is already in use');
    }
    const generation = ++inputGeneration[requested];
    const current = await open(requested);
    if (generation !== inputGeneration[requested]) {
      closeIfIdle(requested);
      return;
    }
    const input = new AudioRecorder({
      androidInputPreset: 'voiceCommunication',
      iosVoiceProcessing: true,
    });
    recorder = input;
    interrupted = stopped;
    const configured = input.onAudioReady(
      { sampleRate: INPUT_RATE, bufferLength: INPUT_FRAMES, channelCount: 1 },
      ({ buffer }) => {
        if (generation !== inputGeneration[requested] || context !== current) {
          return;
        }
        const pcm = buffer.getChannelData(0);
        let sum = 0;
        for (const value of pcm) {
          sum += value * value;
        }
        level(Math.min(1, Math.sqrt(sum / Math.max(1, pcm.length)) * 5));
        samples(pcm);
      },
    );
    input.onError(error => {
      if (generation === inputGeneration[requested]) {
        lose(error.message);
      }
    });
    try {
      if (configured.status === 'error') {
        throw new Error(configured.message);
      }
      const result = await input.start();
      if (result.status === 'error') {
        throw new Error(result.message);
      }
      if (generation !== inputGeneration[requested]) {
        await input.stop();
      }
    } catch (error) {
      if (generation === inputGeneration[requested]) {
        stopInput(requested);
        closeIfIdle(requested);
      }
      throw error;
    }
  }
  async function play(
    requested: AudioOwner,
    pcm: Float32Array,
    sampleRate: number,
    words: KokoroTtsChunk['words'] = [],
    offset = 0,
    onWord: (location: number, length: number) => void = () => {},
  ) {
    const generation = outputGeneration[requested];
    const current = await open(requested);
    if (generation !== outputGeneration[requested]) {
      closeIfIdle(requested);
      return;
    }
    const buffer = current.createBuffer(1, pcm.length, sampleRate);
    buffer.copyToChannel(new Float32Array(pcm), 0);
    const source = current.createBufferSource();
    source.buffer = buffer;
    source.connect(current.destination);
    const start = Math.max(current.currentTime, nextStart);
    const duration = pcm.length / sampleRate;
    nextStart = start + duration;
    timeline.push({ start, duration });
    await new Promise<void>((resolve, reject) => {
      let wordIndex = 0;
      let finished = false;
      const timer = setInterval(() => {
        if (generation !== outputGeneration[requested]) {
          return;
        }
        const elapsed = current.currentTime - start + offset;
        while (wordIndex < words.length && words[wordIndex].start <= elapsed) {
          const word = words[wordIndex++];
          onWord(word.offset, word.text.length);
        }
      }, WORD_POLL_MS);
      const item = {
        stop(error?: Error) {
          if (finished) {
            return;
          }
          finished = true;
          clearInterval(timer);
          // Route loss may already have detached the source; its wait must still settle.
          try {
            source.onended = null;
            source.stop();
          } catch {
            /* Already stopped. */
          }
          try {
            source.disconnect();
          } catch {
            /* Already detached. */
          }
          playing.delete(item);
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        },
      };
      playing.add(item);
      source.onended = () => {
        item.stop();
      };
      try {
        source.start(start);
      } catch (error) {
        reject(error);
        item.stop();
      }
    });
    // Playback owns its session until the utterance ends; gaps must not tear down capture.
  }
  return {
    permission: async () =>
      (await AudioManager.requestRecordingPermissions()) === 'Granted',
    record,
    play,
    stopInput,
    stopOutput,
    finishOutput: closeIfIdle,
    playedMs() {
      if (!context) {
        return 0;
      }
      const now = context.currentTime;
      while (
        timeline.length > 0 &&
        timeline[0].start + timeline[0].duration <= now
      ) {
        playedSeconds += timeline.shift()!.duration;
      }
      return (
        (playedSeconds +
          timeline.reduce(
            (sum, item) =>
              sum + Math.max(0, Math.min(item.duration, now - item.start)),
            0,
          )) *
        1000
      );
    },
    async stop(requested?: AudioOwner) {
      stopInput(requested);
      stopOutput(requested);
      // Opening may be suspended in the platform's audio-session activation.
      // Wait for it before releasing, so a replacement cannot inherit a late context.
      await opening?.catch(() => {});
      stopInput(requested);
      stopOutput(requested);
      await closing;
    },
  };
}
export type LocalAudio = ReturnType<typeof createAudio>;
