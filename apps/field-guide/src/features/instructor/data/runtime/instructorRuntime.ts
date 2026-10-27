import type { InstructorStore } from '../../state/instructorStore';
import type { Cancel, Platform, Timers } from '../../../../platform/ports';
import {
  NetworkQuality,
  Transport,
} from '../../../../platform/connectivity/networkStatus';
import { AgentState } from '../../domain/agent/agentStatus';
import {
  isSwitching,
  AnswerSource,
  InstructorMode,
  ModeCause,
  VoiceSource,
  type ModeStatus,
} from '../../domain/mode/modeTypes';
import { createQualityEstimator } from '../../../../platform/connectivity/networkQuality';
import {
  createBackoff,
  type BackoffLimits,
} from '../../../../platform/connectivity/backoff';
import { createNetworkService } from '../../../../platform/connectivity/networkService';
import { createModeController } from '../../domain/mode/modeController';
import { runSwitch } from '../../domain/mode/modeSwitcher';
import { NO_PROXY_REASON } from '../../domain/mode/modeCopy';
import { createAgentClient } from '../agent/agentClient';
import { createCloudModel } from '../answerers/cloudModel';
import { createOnDeviceModel } from '../answerers/onDeviceModel';
import { createModelInstructor } from '../../domain/turn/modelInstructor';
import {
  VoiceStartFailure,
  type VoiceRuntimeState,
} from '../../domain/voice/voiceSession';
import { voiceFailure } from '../../domain/voice/voiceFailure';
import type { Pack } from '../../../pack/pack';
import type { InstructorRuntime } from '../../domain/instructorRuntime';
import { createInstructorForeground } from './instructorForeground';
import { createInstructorSessions } from './instructorSessions';
import { createAgentConnection } from '../proxy/agentConnection';
import { createProxyClient } from '../proxy/proxyClient';
import {
  offlineAnnouncement,
  switchSources,
  switchTasks,
  type OfflineVoice,
} from './instructorSwitch';

export interface InstructorRuntimeOptions {
  readonly platform: Platform;
  /** A null proxy URL runs with on-device answers and voice only. */
  readonly proxyUrl: string | null;
  readonly offlineVoice: OfflineVoice;
  /** Receives every status the runtime reports. */
  readonly store: InstructorStore;
}
/** Waits before reconnecting a conversation that fell back to the device voice. */
export const AgentRetry: BackoffLimits = { initialMs: 2000, maxMs: 60000 };
export function createInstructorRuntime({
  platform,
  proxyUrl: url,
  offlineVoice,
  store,
}: InstructorRuntimeOptions): InstructorRuntime {
  const { clock, timers } = platform;
  const input = platform.speechInput;
  const output = platform.speechOutput;
  const audio = platform.audioLink;
  const paths = platform.networkMonitor;
  const foreground = createInstructorForeground(platform.appState);
  const model = createOnDeviceModel(platform.languageModel);
  const proxy = url === null ? null : createProxyClient(url, platform);
  const connection = createAgentConnection({ proxy, clock });
  // Switch waits are tracked so stop cancels the ones still pending.
  const switchTimers = new Set<Cancel>();
  const switchTiming: Timers = {
    after(delayMs, run) {
      const cancel = timers.after(delayMs, () => {
        switchTimers.delete(cancel);
        run();
      });
      switchTimers.add(cancel);
      return () => {
        switchTimers.delete(cancel);
        cancel();
      };
    },
    every: timers.every,
  };
  const pathQuality = createQualityEstimator();
  let pack: Pack | null = null;
  let started = false;
  let disposed = false;
  let switchId = 0;
  let idle = true;
  const agentBackoff = createBackoff(AgentRetry, platform.random);
  let cancelAgentRetryWait: Cancel | null = null;
  let agentRetryDue = false;
  let routeSeen = false;
  let snapshot: VoiceRuntimeState = {
    revision: 0,
    canStart: foreground.isForeground(),
    foreground: foreground.isForeground(),
    announcement: null,
  };
  // Screens read voice state from the store, so it starts from this runtime's foreground.
  store.getState().voiceChanged(snapshot);
  function publishVoice(status: ModeStatus, switched = false) {
    const canStart = foreground.isForeground() && !isSwitching(status.mode);
    snapshot = {
      revision: snapshot.revision + 1,
      canStart,
      foreground: foreground.isForeground(),
      announcement:
        switched &&
        status.mode === InstructorMode.offline &&
        status.cause === ModeCause.network
          ? offlineAnnouncement(status, switchId)
          : null,
    };
    store.getState().voiceChanged(snapshot);
  }
  function primaryFailure(failure: VoiceStartFailure) {
    if (
      failure === VoiceStartFailure.quota ||
      failure === VoiceStartFailure.auth
    ) {
      connection.disable();
      controller.agentAvailable(false);
      store
        .getState()
        .agentChanged({ state: AgentState.failed, reason: failure });
    } else if (failure === VoiceStartFailure.network) {
      network.report({ ok: false });
    }
  }
  function cancelAgentRetry() {
    cancelAgentRetryWait?.();
    cancelAgentRetryWait = null;
    agentRetryDue = false;
  }
  function scheduleAgentRetry() {
    if (cancelAgentRetryWait !== null) {
      return;
    }
    cancelAgentRetryWait = timers.after(agentBackoff.next(), () => {
      cancelAgentRetryWait = null;
      agentRetryDue = true;
      retryAgent();
    });
  }
  /** Restarts a conversation that fell back to the device voice, so it reconnects to the agent. */
  function retryAgent() {
    if (!agentRetryDue || !idle) {
      return;
    }
    agentRetryDue = false;
    const status = controller.current();
    if (
      !started ||
      !foreground.isForeground() ||
      status.mode !== InstructorMode.online ||
      status.voice !== VoiceSource.device ||
      !connection.available()
    ) {
      return;
    }
    controller.agentAvailable(true);
    publishVoice(controller.current());
  }
  const probe =
    proxy === null
      ? async () => {
          throw new Error(VoiceStartFailure.network);
        }
      : proxy.ping;
  async function switchMode(status: ModeStatus) {
    const id = ++switchId;
    const tasks = switchTasks(status.mode, {
      input,
      output,
      offlineVoice,
      model,
      pack,
      probe,
      prepareAgent: async () => {
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
    });
    const outcome = await runSwitch(
      id,
      tasks,
      step => {
        if (started && id === switchId) {
          store.getState().switchStepArrived(step);
        }
      },
      { clock, timers: switchTiming },
    );
    if (!started || id !== switchId) {
      return;
    }
    const target =
      status.mode === InstructorMode.switchingToOffline
        ? InstructorMode.offline
        : InstructorMode.online;
    controller.switched(target, switchSources(status.mode, outcome, model));
  }
  const controller = createModeController({
    clock,
    timers,
    emitMode: status => {
      store.getState().modeChanged(status);
      if (started) {
        followMode(status);
      }
    },
    emitSuggestion: value => store.getState().suggestionChanged(value),
  });
  let previousMode = controller.current().mode;
  /** Stops voice for a switch, runs it and republishes the voice state once modes change. */
  function followMode(status: ModeStatus) {
    if (status.mode === previousMode) {
      return;
    }
    const switched = isSwitching(previousMode);
    previousMode = status.mode;
    if (isSwitching(status.mode)) {
      cancelAgentRetry();
      sessions.stop();
      connection.clear();
    }
    publishVoice(status, switched);
    if (isSwitching(status.mode)) {
      switchMode(status);
    }
  }
  const network = createNetworkService({
    paths,
    probe,
    timers,
    random: platform.random,
    emit(status) {
      store.getState().networkChanged(status);
      controller.network(status);
      if (
        controller.current().mode === InstructorMode.offline &&
        controller.current().cause === ModeCause.startup
      ) {
        controller.switched(InstructorMode.offline, {
          voice: VoiceSource.device,
          answers: model.isReady()
            ? AnswerSource.deviceModel
            : AnswerSource.script,
        });
      }
      // Each later status is a change, so a good one is a new or recovered route.
      const changed = routeSeen;
      routeSeen = true;
      if (changed && status.quality === NetworkQuality.good) {
        cancelAgentRetry();
        agentBackoff.reset();
        agentRetryDue = true;
        retryAgent();
      }
    },
  });
  const cloud = createCloudModel({
    proxy,
    clock,
    timers,
    isOnline: () => controller.current().mode === InstructorMode.online,
    onFailure: () => network.report({ ok: false }),
  });
  const instructor = createModelInstructor([cloud, model]);
  const sessions = createInstructorSessions({
    input,
    output,
    audio,
    timers,
    prompt: foreground.prompt,
    offlineVoice: offlineVoice.voice,
    agentAvailable: connection.available,
    foreground: foreground.isForeground,
    onPrimaryFailure: primaryFailure,
    onVoiceStarted: voice => {
      controller.voiceStarted(voice);
      if (voice === VoiceSource.device) {
        scheduleAgentRetry();
      }
    },
    networkOffline: () =>
      store.getState().network.quality === NetworkQuality.offline,
    client: handlers =>
      createAgentClient({
        signedUrl: connection.signedUrl,
        connect: platform.socket,
        audio: audio(),
        timers,
        handlers: {
          ...handlers,
          status: value => {
            if (value.state === AgentState.connected) {
              cancelAgentRetry();
              agentBackoff.reset();
              controller.voiceStarted(VoiceSource.agent);
            }
            store.getState().agentChanged(value);
          },
          roundTrip: ms => network.report({ ok: true, ms }),
        },
      }),
  });
  return {
    instructor,
    sessionFor(guide) {
      if (!snapshot.canStart || disposed) {
        return null;
      }
      return sessions.sessionFor(controller.current(), guide);
    },
    setPack(value) {
      pack = value;
    },
    setInstructorOpen(open) {
      network.setActive(open);
    },
    setIdle(value) {
      idle = value;
      controller.setIdle(value && foreground.isForeground());
      retryAgent();
    },
    requestMode(request) {
      if (started) {
        controller.request(request);
      }
    },
    start() {
      if (started || disposed) {
        return;
      }
      started = true;
      foreground.start(active => {
        if (!active) {
          cancelAgentRetry();
          sessions.stop();
          connection.clear();
          instructor.cancel();
        }
        network.setForeground(active);
        controller.setIdle(idle && active);
        publishVoice(controller.current());
      });
      controller.agentAvailable(connection.available());
      if (url === null) {
        controller.network({
          quality: NetworkQuality.offline,
          transport: Transport.none,
          reason: NO_PROXY_REASON,
        });
        controller.switched(InstructorMode.offline, {
          voice: VoiceSource.device,
          answers: model.isReady()
            ? AnswerSource.deviceModel
            : AnswerSource.script,
        });
        paths.start(path =>
          store.getState().networkChanged(pathQuality.path(path)),
        );
      } else {
        network.setForeground(foreground.isForeground());
        network.start();
      }
    },
    stop() {
      if (disposed) {
        return;
      }
      disposed = true;
      started = false;
      cancelAgentRetry();
      sessions.stop();
      switchId++;
      connection.clear();
      foreground.stop();
      [...switchTimers].forEach(cancel => cancel());
      switchTimers.clear();
      if (url === null) {
        paths.stop();
      } else {
        network.stop();
      }
      controller.dispose();
      instructor.cancel();
    },
  };
}
