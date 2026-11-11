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

import { MAX_LOCAL_REPLY_TOKENS } from './limits';

// Inference has no download path: factories receive verified local files.
export function createInference(paths: () => ModelPaths) {
  setTelemetryEnabled(false);
  let tts: Promise<KokoroTextToSpeech<'af_heart'>> | null = null;
  let stt: Promise<WhisperSpeechToText<'en'>> | null = null;
  // Recognition must not queue behind a long answer or synthesized sentence when the worker interrupts.
  const runtimes = new Map<string, WorkletRuntime>();
  function runtimeFor(name: string) {
    let runtime = runtimes.get(name);
    if (!runtime) {
      runtime = createWorkletRuntime({ name });
      runtimes.set(name, runtime);
    }
    return runtime;
  }
  return {
    speech() {
      if (!tts) {
        const p = paths();
        tts = createKokoroTextToSpeech(
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
        ).catch(error => {
          tts = null;
          throw error;
        });
      }
      return tts;
    },
    recognition() {
      if (!stt) {
        const p = paths();
        stt = createWhisperSpeechToText(
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
        ).catch(error => {
          stt = null;
          throw error;
        });
      }
      return stt;
    },
    answer(instructions: string): Promise<LLMChatSession> {
      const p = paths();
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
    },
    async release() {
      const previous = [tts, stt];
      tts = null;
      stt = null;
      await Promise.all(
        previous.map(async value => {
          try {
            (await value)?.dispose();
          } catch {
            /* Failed loads hold no usable runner. */
          }
        }),
      );
      runtimes.clear();
    },
  };
}
export type Inference = ReturnType<typeof createInference>;
