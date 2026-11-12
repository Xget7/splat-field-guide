import type {
  LLMChatSession,
  WhisperSpeechToText,
  KokoroTextToSpeech,
} from 'react-native-executorch';
import type { LanguageModel, SpeechInput, SpeechOutput } from '../capabilities';
import type { LocalAudio } from './audio';
import type { Inference } from './inference';
import type { ModelStore } from './modelStore';

import { MAX_LOCAL_REPLY_TOKENS } from './limits';

const LOCALE = 'en-US';
const cancelled = () => new Error('Local inference cancelled');
const sceneReserved = () =>
  new Error('Local inference is unavailable while a 3D scene is resident');

/** Adapts streaming runners to the same cancellation and ownership contract the instructor uses. */
export function createLocalCapabilities(
  audio: LocalAudio,
  inference: Inference,
  models: ModelStore,
) {
  let listenId = 0;
  let speechId = 0;
  let answerId = 0;
  let recognition: WhisperSpeechToText<'en'> | null = null;
  let speech: KokoroTextToSpeech<'af_heart'> | null = null;
  let answer: LLMChatSession | null = null;
  let speechTail: Promise<void> = Promise.resolve();
  let listeningTail: Promise<void> = Promise.resolve();
  let answerTail: Promise<unknown> = Promise.resolve();
  let warm: { instructions: string; session: Promise<LLMChatSession> } | null =
    null;
  const retirements = new Set<Promise<unknown>>();
  function discardWarm() {
    const previous = warm;
    warm = null;
    if (previous) {
      const retired = previous.session
        .then(session => inference.disposeAnswer(session))
        .catch(() => {});
      retirements.add(retired);
      retired.finally(() => retirements.delete(retired));
    }
  }
  const input: SpeechInput = {
    requestPermission: async () =>
      (await audio.permission()) ? 'granted' : 'denied',
    async prepare(locale) {
      const id = listenId;
      if (inference.sceneReserved()) return 'unavailable';
      if (locale !== LOCALE) {
        return 'unavailable';
      }
      await models.restore('listening');
      if (inference.sceneReserved()) return 'unavailable';
      if (id !== listenId) throw cancelled();
      if (!models.isReady('listening')) {
        return 'unavailable';
      }
      const prepared = await inference.recognition();
      if (id !== listenId) throw cancelled();
      recognition = prepared;
      return 'available';
    },
    async listen(locale, onPartial, onTurn, onLevel, onVoice, onStopped) {
      input.cancel();
      const id = ++listenId;
      await listeningTail;
      if (id !== listenId) {
        return;
      }
      if (locale !== LOCALE || !recognition) {
        throw new Error('Prepare speech recognition first');
      }
      const runner = recognition;
      const current = () => id === listenId;
      let committed = '';
      const stream = runner.stream({ language: 'en' });
      listeningTail = (async () => {
        try {
          for await (const update of stream) {
            if (!current()) {
              break;
            }
            // ExecuTorch commits cumulative text; callers accept each completed turn once.
            if (update.committed !== committed) {
              if (!update.committed.startsWith(committed)) {
                throw new Error(
                  'Recognition transcript lost its committed prefix',
                );
              }
              const turn = update.committed.slice(committed.length).trim();
              committed = update.committed;
              if (turn) {
                onVoice(false);
                onTurn(turn);
              }
            }
            onPartial(update.nonCommitted);
            onVoice(update.nonCommitted.trim() !== '');
          }
          if (current()) {
            input.cancel();
            onStopped('Speech recognition stopped');
          }
        } catch (error) {
          if (current()) {
            input.cancel();
            onStopped(
              error instanceof Error
                ? error.message
                : 'Speech recognition failed',
            );
          }
        }
      })();
      try {
        await audio.record(
          'local',
          samples => {
            if (current()) {
              runner.streamInsert(samples);
            }
          },
          amplitude => {
            if (current()) {
              onLevel(amplitude);
            }
          },
          reason => {
            if (current()) {
              input.cancel();
              output.stop();
              onStopped(reason);
            }
          },
        );
      } catch (error) {
        if (current()) {
          input.cancel();
        }
        throw error;
      }
    },
    cancel() {
      listenId++;
      // streamStop flushes by design; generation guards discard those final buffered words.
      recognition?.streamStop();
      recognition?.transcribeStop();
      audio.stopInput('local');
    },
  };
  const output: SpeechOutput = {
    async prepare() {
      const id = speechId;
      if (inference.sceneReserved()) throw sceneReserved();
      await models.restore('speaking');
      if (inference.sceneReserved()) throw sceneReserved();
      if (id !== speechId) throw cancelled();
      if (!models.isReady('speaking'))
        throw new Error('Prepare speaking files before using local speech');
      const prepared = await inference.speech();
      if (id !== speechId) throw cancelled();
      speech = prepared;
    },
    speak(text, locale, onWord) {
      output.stop();
      const id = ++speechId;
      const current = () => id === speechId;
      const task = speechTail
        .catch(() => {})
        .then(async () => {
          if (!current()) {
            return;
          }
          if (locale !== LOCALE) {
            throw new Error('This offline voice supports English only');
          }
          const runner = await inference.speech().catch(error => {
            if (current()) {
              throw error;
            }
            return null;
          });
          if (!current() || !runner) {
            return;
          }
          speech = runner;
          let offset = 0;
          let previousPlayback: Promise<void> = Promise.resolve();
          try {
            for await (const chunk of speech.synthesize(text, {
              voice: 'af_heart',
            })) {
              if (!current()) {
                break;
              }
              // Synthesize one sentence ahead, keeping at most two chunks in memory.
              await previousPlayback;
              if (!current()) {
                break;
              }
              previousPlayback = audio.play(
                'local',
                chunk.audio,
                chunk.sampleRate,
                chunk.words,
                offset,
                (location, length) => {
                  if (current()) {
                    onWord(location, length);
                  }
                },
              );
              // A route loss can reject while the next sentence is still synthesizing.
              previousPlayback.catch(() => {});
              offset += chunk.duration;
            }
            await previousPlayback;
          } catch (error) {
            speech?.synthesizeStop();
            audio.stopOutput('local');
            if (current()) {
              throw error;
            }
          } finally {
            await previousPlayback.catch(() => {});
            if (current()) {
              audio.finishOutput('local');
            }
          }
        });
      speechTail = task.catch(() => {});
      return task;
    },
    stop() {
      speechId++;
      speech?.synthesizeStop();
      audio.stopOutput('local');
    },
  };
  const model: LanguageModel = {
    availability: () =>
      inference.sceneReserved()
        ? 'unavailable'
        : models.isReady('answers')
        ? 'available'
        : 'modelsMissing',
    prewarm(instructions) {
      if (warm?.instructions === instructions || answer) {
        return;
      }
      discardWarm();
      if (inference.sceneReserved() || !models.isReady('answers')) {
        return;
      }
      const session = inference.answer(instructions);
      // Failure is handled by respond; attaching a handler also makes speculative warming safe.
      session.catch(() => {});
      warm = { instructions, session };
    },
    respond(instructions, prompt, onPartial) {
      answerId++;
      answer?.stop();
      const id = ++answerId;
      const current = () => id === answerId;
      const task = answerTail
        .catch(() => {})
        .then(async () => {
          if (!current()) {
            throw cancelled();
          }
          if (inference.sceneReserved()) throw sceneReserved();
          await models.restore('answers');
          if (inference.sceneReserved()) throw sceneReserved();
          if (!current()) {
            throw cancelled();
          }
          const prepared =
            warm?.instructions === instructions ? warm.session : null;
          if (prepared) {
            warm = null;
          } else {
            discardWarm();
          }
          const session = await (prepared ?? inference.answer(instructions));
          answer = session;
          let text = '';
          try {
            if (!current()) {
              throw cancelled();
            }
            const result = await session.sendMessage(prompt, token => {
              if (current()) {
                text += token;
                onPartial(text);
              }
            });
            if (!current() || result.finishReason === 'cancelled') {
              throw cancelled();
            }
            // A token-limit stop may end mid-instruction; never commit that as a complete answer.
            if (
              result.finishReason !== 'stop' ||
              result.stats.some(
                stat => stat.numTokens >= MAX_LOCAL_REPLY_TOKENS,
              )
            ) {
              throw new Error(
                'Local answer did not complete within its reply budget',
              );
            }
            const message = result.messages[result.messages.length - 1];
            if (
              message?.role !== 'assistant' ||
              typeof message.content !== 'string' ||
              !message.content.trim()
            ) {
              throw new Error('Local answer is empty or malformed');
            }
            return message.content;
          } finally {
            if (answer === session) {
              answer = null;
            }
            await inference.disposeAnswer(session);
          }
        });
      answerTail = task.catch(() => {});
      return task;
    },
    cancel() {
      answerId++;
      answer?.stop();
      discardWarm();
    },
  };
  return {
    input,
    output,
    model,
    quiesce() {
      input.cancel();
      output.stop();
      model.cancel();
      recognition = null;
      speech = null;
      return Promise.allSettled([
        speechTail,
        listeningTail,
        answerTail,
        ...retirements,
      ]).then(() => {});
    },
  };
}
