import type {
  AudioLink,
  SpeechInput,
  SpeechOutput,
  Timers,
} from '../../../../platform/ports';
import {
  InstructorMode,
  VoiceSource,
  type ModeStatus,
} from '../../domain/mode/modeTypes';
import type { AgentClient } from '../agent/agentClient';
import {
  createAgentVoiceSession,
  type SessionAgentHandlers,
} from '../voice/agentVoiceSession';
import { createFallbackVoiceSession } from '../voice/fallbackVoiceSession';
import { createPipelineVoiceSession } from '../voice/pipelineVoiceSession';
import { recognitionHintsFor } from '../../domain/voice/recognitionHints';
import { SpeechVoice } from '../../domain/voice/voiceCopy';
import type {
  VoiceConnection,
  VoiceSession,
  VoiceStartFailure,
  VoicePrompt,
} from '../../domain/voice/voiceSession';
import type { Pack } from '../../../pack/pack';
import type { ExchangeIds } from '../../domain/turn/exchange';

interface SessionDependencies {
  input: () => SpeechInput;
  output: () => SpeechOutput;
  audio: () => AudioLink;
  timers: Timers;
  prompt: VoicePrompt;
  ids: ExchangeIds;
  offlineVoice: SpeechVoice;
  client(handlers: SessionAgentHandlers): AgentClient;
  agentAvailable(): boolean;
  foreground(): boolean;
  onPrimaryFailure(failure: VoiceStartFailure): void;
  onVoiceStarted(voice: VoiceSource): void;
  networkOffline(): boolean;
}
export function createInstructorSessions(deps: SessionDependencies) {
  const sessions = new Set<VoiceSession>();
  function own(voice: VoiceConnection): VoiceConnection {
    let stoppedQuestion: string | null = null;
    const session: VoiceSession = {
      async start(context, events) {
        stoppedQuestion = null;
        sessions.add(session);
        try {
          await voice.session.start(context, {
            ...events,
            ended: (reason, pending) => {
              sessions.delete(session);
              stoppedQuestion = pending;
              events.ended(reason, pending);
            },
          });
        } catch (error) {
          sessions.delete(session);
          throw error;
        }
      },
      say: utterance => voice.session.say(utterance),
      update: context => voice.session.update(context),
      interrupt: () => voice.session.interrupt(),
      setMuted: muted => voice.session.setMuted(muted),
      stop() {
        stoppedQuestion = voice.session.stop() ?? stoppedQuestion;
        sessions.delete(session);
        return stoppedQuestion;
      },
    };
    return {
      session,
      get questions() {
        return sessions.has(session) && deps.foreground()
          ? voice.questions
          : null;
      },
    };
  }
  return {
    sessionFor(status: ModeStatus, guide: Pack): VoiceConnection {
      const pipeline = (voice: SpeechVoice): VoiceConnection => ({
        session: createPipelineVoiceSession({
          voice,
          hints: recognitionHintsFor(guide),
          input: deps.input,
          output: deps.output,
          timers: deps.timers,
          prompt: deps.prompt,
        }),
        questions: null,
      });
      if (status.mode === InstructorMode.offline) {
        return own(pipeline(deps.offlineVoice));
      }
      if (!deps.agentAvailable()) {
        return own(pipeline(SpeechVoice.system));
      }
      const primary = createAgentVoiceSession({
        pack: guide,
        audio: deps.audio,
        client: deps.client,
        ids: deps.ids,
        prompt: deps.prompt,
      });
      const fallback = createFallbackVoiceSession({
        primary,
        primaryQuestions: primary,
        fallback: pipeline(SpeechVoice.system).session,
        onPrimaryFailure: deps.onPrimaryFailure,
        onFallbackStarted: () => deps.onVoiceStarted(VoiceSource.device),
        networkOffline: deps.networkOffline,
      });
      return own({
        session: fallback,
        get questions() {
          return fallback.questions;
        },
      });
    },
    stop() {
      for (const session of [...sessions]) {
        session.stop();
      }
    },
  };
}
