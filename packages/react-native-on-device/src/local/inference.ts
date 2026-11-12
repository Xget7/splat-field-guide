import {
  createWorkletRuntime,
  type WorkletRuntime,
} from 'react-native-worklets';
import {
  createKokoroTextToSpeech,
  createLLMChatSession,
  createWhisperSpeechToText,
  setTelemetryEnabled,
} from 'react-native-executorch';
import type {
  KokoroTextToSpeech,
  LLMChatSession,
  WhisperSpeechToText,
} from 'react-native-executorch';
import type { ModelPaths } from './modelStore';
import type { OfflineModelGroupId, SceneLease } from '../capabilities';
import { MAX_LOCAL_REPLY_TOKENS } from './limits';

interface NativeResource {
  dispose(): void;
}
interface ResourceEntry<T extends NativeResource = NativeResource> {
  promise: Promise<T>;
  value?: T;
  retired: boolean;
  disposed: boolean;
}
const retired = () =>
  new Error('Local inference construction cancelled during retirement');
const sceneReserved = () =>
  new Error('Local inference is unavailable while a 3D scene is resident');

// Inference has no download path: factories receive verified local files.
export function createInference(
  paths: (group?: OfflineModelGroupId) => ModelPaths,
) {
  setTelemetryEnabled(false);
  let tts: Promise<KokoroTextToSpeech<'af_heart'>> | null = null;
  let stt: Promise<WhisperSpeechToText<'en'>> | null = null;
  let generation = 0;
  let nativeTail: Promise<unknown> = Promise.resolve();
  let releasing: Promise<void> | null = null;
  const resources = new Set<ResourceEntry>();
  const byValue = new Map<NativeResource, ResourceEntry>();
  const scenes = new Set<symbol>();
  // Recognition execution can interrupt generation; only construction and retirement are serial.
  const runtimes = new Map<string, WorkletRuntime>();
  function runtimeFor(name: string) {
    let runtime = runtimes.get(name);
    if (!runtime) {
      runtime = createWorkletRuntime({ name });
      runtimes.set(name, runtime);
    }
    return runtime;
  }
  function serial<T>(work: () => T | Promise<T>): Promise<T> {
    const task = nativeTail.catch(() => {}).then(work);
    nativeTail = task.catch(() => {});
    return task;
  }
  function dispose(entry: ResourceEntry) {
    if (entry.disposed) return;
    if (entry.value) {
      entry.value.dispose();
      byValue.delete(entry.value);
    }
    entry.disposed = true;
    resources.delete(entry);
  }
  function construct<T extends NativeResource>(
    create: () => Promise<T>,
  ): Promise<T> {
    if (scenes.size) return Promise.reject(sceneReserved());
    const requested = generation;
    const gate = releasing ?? Promise.resolve();
    let entry: ResourceEntry<T>;
    // Wait outside the native queue: release needs that queue to retire older resources.
    const promise = gate
      .then(() =>
        serial(async () => {
          if (scenes.size) throw sceneReserved();
          if (entry.retired || requested !== generation) throw retired();
          const value = await create();
          entry.value = value;
          byValue.set(value, entry);
          if (entry.retired || requested !== generation) {
            dispose(entry);
            throw retired();
          }
          return value;
        }),
      )
      .catch(error => {
        if (!entry.value) resources.delete(entry);
        throw error;
      });
    // Promise callbacks run after this synchronous owner registration.
    entry = { promise, retired: false, disposed: false };
    resources.add(entry);
    // An owner may cancel before it starts awaiting its constructor.
    promise.catch(() => {});
    return promise;
  }
  return {
    sceneReserved: () => scenes.size > 0,
    reserveScene(): SceneLease {
      const token = Symbol('scene');
      scenes.add(token);
      generation += 1;
      return {
        release: () => {
          scenes.delete(token);
        },
      };
    },
    speech() {
      if (scenes.size) return Promise.reject(sceneReserved());
      if (!tts) {
        const pending = construct(() => {
          const p = paths('speaking');
          return createKokoroTextToSpeech(
            {
              name: 'kokoro',
              modelPaths: {
                durationPredictor: p.duration,
                synthesizer: p.synthesizer,
              },
              phonemizer: {
                lang: 'en-us',
                lexiconSource: p.lexicon,
                neuralModelSource: p.phonemizer,
              },
              voices: { af_heart: p.voice },
            },
            runtimeFor('MirisSpeech'),
          );
        });
        tts = pending;
        pending.catch(() => {
          if (tts === pending) tts = null;
        });
      }
      return tts;
    },
    recognition() {
      if (scenes.size) return Promise.reject(sceneReserved());
      if (!stt) {
        const pending = construct(() => {
          const p = paths('listening');
          return createWhisperSpeechToText(
            {
              modelPath: p.whisper,
              tokenizerPath: p.whisperTokenizer,
              supportedLanguages: ['en'],
              vadModel: {
                modelPath: p.vad,
                defaultOptions: {
                  speechThreshold: 0.6,
                  minSpeechDurationMs: 250,
                  minSilenceDurationMs: 500,
                  speechPadMs: 30,
                  mergeGapMs: 0,
                },
              },
            },
            runtimeFor('MirisRecognition'),
          );
        });
        stt = pending;
        pending.catch(() => {
          if (stt === pending) stt = null;
        });
      }
      return stt;
    },
    answer(instructions: string): Promise<LLMChatSession> {
      return construct(() => {
        const p = paths('answers');
        return createLLMChatSession(
          {
            modelPath: p.llm,
            tokenizerPath: p.tokenizer,
            tokenizerConfigPath: p.tokenizerConfig,
          },
          {
            initialMessages: [{ role: 'system', content: instructions }],
            generationConfig: {
              temperature: 0,
              maxNewTokens: MAX_LOCAL_REPLY_TOKENS,
            },
          },
          runtimeFor('MirisAnswers'),
        );
      });
    },
    disposeAnswer(session: LLMChatSession): Promise<void> {
      const entry = byValue.get(session);
      if (!entry) return Promise.resolve();
      entry.retired = true;
      return serial(() => dispose(entry));
    },
    release(operations: Promise<unknown> = Promise.resolve()): Promise<void> {
      generation += 1;
      const previous = releasing ?? Promise.resolve();
      const retiring = [...resources];
      retiring.forEach(entry => {
        entry.retired = true;
      });
      tts = null;
      stt = null;
      // Never hold the native queue while waiting for work whose finally uses that same queue.
      const task = (async () => {
        const settled = await Promise.allSettled([previous, operations]);
        await Promise.allSettled(retiring.map(entry => entry.promise));
        await serial(() => {
          const failures: unknown[] = [];
          for (const entry of retiring) {
            try {
              dispose(entry);
            } catch (error) {
              failures.push(error);
            }
          }
          if (failures.length)
            throw new Error('Could not retire all local inference resources');
          runtimes.clear();
        });
        if (settled[1].status === 'rejected') throw settled[1].reason;
      })();
      releasing = task;
      task.then(
        () => {
          if (releasing === task) releasing = null;
        },
        () => {
          // A failed retirement blocks construction until explicit release successfully retries it.
        },
      );
      return task;
    },
  };
}
export type Inference = ReturnType<typeof createInference>;
