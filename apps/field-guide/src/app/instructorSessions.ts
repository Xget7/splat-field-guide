import type { speechInput, speechOutput } from 'react-native-on-device';
import {
  InstructorMode,
  VoiceSource,
  type ModeStatus,
} from '../features/events/types';
import type { AgentClient } from '../features/instructor/agent/agentClient';
import {
  createAgentVoiceSession,
  type SessionAgentHandlers,
} from '../features/instructor/voice/agentVoiceSession';
import { createFallbackVoiceSession } from '../features/instructor/voice/fallbackVoiceSession';
import { createPipelineVoiceSession } from '../features/instructor/voice/pipelineVoiceSession';
import { recognitionHintsFor } from '../features/instructor/voice/recognitionHints';
import { SpeechVoice } from '../features/instructor/voice/voiceCopy';
import type {
  VoiceConnection,
  VoiceSession,
  VoiceStartFailure,
} from '../features/instructor/voice/voiceSession';
import type { Pack } from '../features/pack/pack';

interface SessionDependencies {
  input: typeof speechInput;
  output: typeof speechOutput;
  client(handlers: SessionAgentHandlers): AgentClient;
  agentAvailable(): boolean;
  foreground(): boolean;
  onPrimaryFailure(failure: VoiceStartFailure): void;
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
      const pipeline = (
        voice: (typeof SpeechVoice)[keyof typeof SpeechVoice],
      ): VoiceConnection => ({
        session: createPipelineVoiceSession({
          voice,
          hints: recognitionHintsFor(guide),
          input: deps.input,
          output: deps.output,
        }),
        questions: null,
      });
      if (status.mode === InstructorMode.offline) {
        return own(pipeline(SpeechVoice.kokoro));
      }
      if (status.voice === VoiceSource.device || !deps.agentAvailable()) {
        return own(pipeline(SpeechVoice.system));
      }
      const primary = createAgentVoiceSession({
        pack: guide,
        input: deps.input,
        client: deps.client,
      });
      const fallback = createFallbackVoiceSession({
        primary,
        primaryQuestions: primary,
        fallback: pipeline(SpeechVoice.system).session,
        onPrimaryFailure: deps.onPrimaryFailure,
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
