import type { Platform } from '../../../../platform/ports';
import type { NetworkService } from '../../../../platform/connectivity/networkService';
import { NetworkQuality } from '../../../../platform/connectivity/networkStatus';
import { AgentState } from '../../domain/agent/agentStatus';
import { createAgentReconnect } from '../../domain/agent/agentReconnect';
import type { InstructorModes } from '../../domain/mode/instructorModes';
import {
  InstructorMode,
  isSwitching,
  VoiceSource,
  type ModeStatus,
} from '../../domain/mode/modeTypes';
import type { ExchangeIds } from '../../domain/turn/exchange';
import { recognitionHintsFor } from '../../domain/voice/recognitionHints';
import { SpeechVoice } from '../../domain/voice/voiceCopy';
import { voiceFailure } from '../../domain/voice/voiceFailure';
import {
  VoiceStartFailure,
  type Utterance,
  type VoiceConnection,
  type VoiceRuntimeState,
  type VoiceSession,
} from '../../domain/voice/voiceSession';
import type { InstructorStore } from '../../state/instructorStore';
import type { Pack } from '../../../pack/pack';
import { createAgentClient } from '../agent/agentClient';
import { createAgentConnection } from '../proxy/agentConnection';
import type { ProxyClient } from '../proxy/proxyClient';
import {
  createAgentVoiceSession,
  type SessionAgentHandlers,
} from '../voice/agentVoiceSession';
import { createFallbackVoiceSession } from '../voice/fallbackVoiceSession';
import { createPipelineVoiceSession } from '../voice/pipelineVoiceSession';
import type { InstructorForeground } from './instructorForeground';

export interface InstructorSessionsOptions {
  readonly platform: Platform;
  readonly proxy: ProxyClient | null;
  readonly offlineVoice: SpeechVoice;
  readonly ids: ExchangeIds;
  readonly foreground: InstructorForeground;
  readonly modes: Pick<
    InstructorModes,
    'current' | 'agentAvailable' | 'voiceStarted'
  >;
  readonly network: Pick<NetworkService, 'report'>;
  /** Receives the voice and agent states the sessions report. */
  readonly store: InstructorStore;
  readonly started: () => boolean;
}

/**
 * The instructor's voice conversations: the agent while it can be reached, a device pipeline
 * otherwise, and the voice state screens read before starting one.
 */
export function createInstructorSessions({
  platform,
  proxy,
  offlineVoice,
  ids,
  foreground,
  modes,
  network,
  store,
  started,
}: InstructorSessionsOptions) {
  const { timers } = platform;
  const connection = createAgentConnection({ proxy, clock: platform.clock });
  const sessions = new Set<VoiceSession>();
  let snapshot: VoiceRuntimeState = {
    revision: 0,
    canStart: foreground.isForeground(),
    foreground: foreground.isForeground(),
    announcement: null,
  };
  // Screens read voice state from the store, so it starts from this foreground.
  store.getState().voiceChanged(snapshot);
  function publish(status: ModeStatus, announcement: Utterance | null = null) {
    snapshot = {
      revision: snapshot.revision + 1,
      canStart: foreground.isForeground() && !isSwitching(status.mode),
      foreground: foreground.isForeground(),
      announcement,
    };
    store.getState().voiceChanged(snapshot);
  }
  /** Quota or auth ends the agent for this run; a network failure lowers the measured quality. */
  function primaryFailure(failure: VoiceStartFailure) {
    if (
      failure === VoiceStartFailure.quota ||
      failure === VoiceStartFailure.auth
    ) {
      connection.disable();
      modes.agentAvailable(false);
      store
        .getState()
        .agentChanged({ state: AgentState.failed, reason: failure });
    } else if (failure === VoiceStartFailure.network) {
      network.report({ ok: false });
    }
  }
  const reconnect = createAgentReconnect({
    timers,
    random: platform.random,
    canReconnect: () => {
      const status = modes.current();
      return (
        started() &&
        foreground.isForeground() &&
        status.mode === InstructorMode.online &&
        status.voice === VoiceSource.device &&
        connection.available()
      );
    },
    // Restarts the conversation, so it reconnects to the agent.
    reconnect: () => {
      modes.agentAvailable(true);
      publish(modes.current());
    },
  });
  const client = (handlers: SessionAgentHandlers) =>
    createAgentClient({
      signedUrl: connection.signedUrl,
      connect: platform.socket,
      audio: platform.audioLink(),
      timers,
      handlers: {
        ...handlers,
        status: value => {
          if (value.state === AgentState.connected) {
            reconnect.connected();
            modes.voiceStarted(VoiceSource.agent);
          }
          store.getState().agentChanged(value);
        },
        roundTrip: ms => network.report({ ok: true, ms }),
      },
    });
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
        return sessions.has(session) && foreground.isForeground()
          ? voice.questions
          : null;
      },
    };
  }
  function connectionFor(status: ModeStatus, guide: Pack): VoiceConnection {
    const pipeline = (voice: SpeechVoice): VoiceConnection => ({
      session: createPipelineVoiceSession({
        voice,
        hints: recognitionHintsFor(guide),
        input: platform.speechInput,
        output: platform.speechOutput,
        timers,
        prompt: foreground.prompt,
      }),
      questions: null,
    });
    if (status.mode === InstructorMode.offline) {
      return own(pipeline(offlineVoice));
    }
    if (!connection.available()) {
      return own(pipeline(SpeechVoice.system));
    }
    const primary = createAgentVoiceSession({
      pack: guide,
      audio: platform.audioLink,
      client,
      ids,
      prompt: foreground.prompt,
    });
    const fallback = createFallbackVoiceSession({
      primary,
      primaryQuestions: primary,
      fallback: pipeline(SpeechVoice.system).session,
      onPrimaryFailure: primaryFailure,
      onFallbackStarted: () => {
        modes.voiceStarted(VoiceSource.device);
        reconnect.fellBack();
      },
      networkOffline: () =>
        store.getState().network.quality === NetworkQuality.offline,
    });
    return own({
      session: fallback,
      get questions() {
        return fallback.questions;
      },
    });
  }
  return {
    agentAvailable: connection.available,
    /** Prepares the agent conversation for a switch, resolving whether online voice can start. */
    async prepareAgent() {
      if (!foreground.isForeground() || !connection.available()) {
        return false;
      }
      try {
        await connection.prepare();
        return true;
      } catch (error) {
        primaryFailure(voiceFailure(error));
        return false;
      }
    },
    /** Reports whether a conversation may start, with the notice a finished switch speaks. */
    publish,
    sessionFor(guide: Pack): VoiceConnection | null {
      return snapshot.canStart ? connectionFor(modes.current(), guide) : null;
    },
    networkChanged: reconnect.networkChanged,
    setIdle: reconnect.setIdle,
    /** Ends every conversation and forgets the agent's session. */
    stop() {
      reconnect.cancel();
      for (const session of [...sessions]) {
        session.stop();
      }
      connection.clear();
    },
  };
}
export type InstructorSessions = ReturnType<typeof createInstructorSessions>;
