import {
  audioLink,
  networkMonitor,
  speechInput,
  speechOutput,
  type NetworkPath,
} from 'react-native-on-device';
import { appEvents, type EventBus } from '../features/events/bus';
import {
  AppEvent,
  AgentState,
  AnswerSource,
  InstructorMode,
  ModeCause,
  NetworkQuality,
  Transport,
  VoiceSource,
  type AppEvents,
  type ModeStatus,
} from '../features/events/types';
import { isSwitching } from '../features/events/mode';
import { createQualityEstimator } from '../features/connectivity/networkQuality';
import {
  createNetworkService,
  pingProbe,
} from '../features/connectivity/networkService';
import { createModeController } from '../features/instructor/mode/modeController';
import { runSwitch } from '../features/instructor/mode/modeSwitcher';
import { NO_PROXY_REASON } from '../features/instructor/mode/modeCopy';
import {
  createAgentClient,
  type AudioPort,
  type SocketPort,
} from '../features/instructor/agent/agentClient';
import { createCloudModel } from '../features/instructor/models/cloudModel';
import { onDeviceModel } from '../features/instructor/models/onDeviceModel';
import {
  createModelInstructor,
  type ModelInstructor,
} from '../features/instructor/models/modelInstructor';
import type { InstructorModel } from '../features/instructor/models/InstructorModel';
import { INSTRUCTOR_PROXY_URL } from '../features/instructor/proxy';
import {
  VoiceStartFailure,
  type VoiceRuntime,
  type VoiceRuntimeState,
} from '../features/instructor/voice/voiceSession';
import { voiceFailure } from '../features/instructor/voice/voiceFailure';
import type { Pack } from '../features/pack/pack';
import {
  createInstructorForeground,
  type AppStatePort,
} from './instructorForeground';
import { createInstructorSessions } from './instructorSessions';
import { createAgentConnection } from './agentConnection';
import {
  offlineAnnouncement,
  switchSources,
  switchTasks,
} from './instructorSwitch';

interface RuntimeDependencies {
  proxyUrl?: string | null;
  appEvents?: EventBus<AppEvents>;
  appState?: AppStatePort;
  networkMonitor?: () => {
    start(callback: (path: NetworkPath) => void): void;
    stop(): void;
  };
  speechInput?: typeof speechInput;
  speechOutput?: typeof speechOutput;
  audioLink?: () => AudioPort;
  onDeviceModel?: InstructorModel;
  fetch?: typeof fetch;
  Request?: typeof XMLHttpRequest;
  connect?: (url: string) => SocketPort;
  now?: () => number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
}
export interface InstructorRuntime extends VoiceRuntime {
  readonly instructor: ModelInstructor;
  setPack(pack: Pack): void;
  setInstructorOpen(open: boolean): void;
  setIdle(idle: boolean): void;
  start(): void;
  stop(): void;
}
export function createInstructorRuntime(
  deps: RuntimeDependencies = {},
): InstructorRuntime {
  const bus = deps.appEvents ?? appEvents;
  const url =
    deps.proxyUrl === undefined ? INSTRUCTOR_PROXY_URL : deps.proxyUrl;
  const input = deps.speechInput ?? speechInput;
  const output = deps.speechOutput ?? speechOutput;
  const paths = deps.networkMonitor ?? networkMonitor;
  const foreground = createInstructorForeground(deps.appState);
  const model = deps.onDeviceModel ?? onDeviceModel;
  const now = deps.now ?? Date.now;
  const schedule = deps.setTimeout ?? setTimeout;
  const cancel = deps.clearTimeout ?? clearTimeout;
  const connection = createAgentConnection({ url, fetchImpl: deps.fetch, now });
  const switchTimers = new Set<ReturnType<typeof setTimeout>>();
  const listeners = new Set<() => void>();
  const subscriptions: (() => void)[] = [];
  const pathQuality = createQualityEstimator();
  let pack: Pack | null = null;
  let started = false;
  let disposed = false;
  let switchId = 0;
  let idle = true;
  let instructorOpen = false;
  let snapshot: VoiceRuntimeState = {
    revision: 0,
    canStart: foreground.isForeground(),
    foreground: foreground.isForeground(),
    announcement: null,
  };
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
    listeners.forEach(listener => listener());
  }
  function primaryFailure(failure: VoiceStartFailure) {
    if (
      failure === VoiceStartFailure.quota ||
      failure === VoiceStartFailure.auth
    ) {
      connection.disable();
      controller.agentAvailable(false);
      bus.emit(AppEvent.agent, { state: AgentState.failed, reason: failure });
    }
  }
  const probe =
    url === null
      ? async () => {
          throw new Error(VoiceStartFailure.network);
        }
      : pingProbe(url, deps.fetch, now);
  async function switchMode(status: ModeStatus) {
    const id = ++switchId;
    const tasks = switchTasks(status.mode, {
      input,
      output,
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
    const timers: ReturnType<typeof setTimeout>[] = [];
    const outcome = await runSwitch(
      id,
      tasks,
      step => {
        if (started && id === switchId) {
          bus.emit(AppEvent.switchStep, step);
        }
      },
      {
        now,
        delay: ms =>
          new Promise(resolve => {
            const timer = schedule(() => {
              switchTimers.delete(timer);
              resolve();
            }, ms);
            timers.push(timer);
            switchTimers.add(timer);
          }),
      },
    );
    timers.forEach(timer => {
      cancel(timer);
      switchTimers.delete(timer);
    });
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
    now,
    setTimeout: deps.setTimeout,
    clearTimeout: deps.clearTimeout,
    emitMode: status => bus.emit(AppEvent.mode, status),
    emitSuggestion: value => bus.emit(AppEvent.modeSuggestion, value),
  });
  let previousMode = controller.current().mode;
  function modeChanged(status: ModeStatus) {
    if (status.mode === previousMode) {
      return;
    }
    const switched = isSwitching(previousMode);
    previousMode = status.mode;
    if (isSwitching(status.mode)) {
      sessions.stop();
      connection.clear();
    }
    publishVoice(status, switched);
    if (isSwitching(status.mode)) {
      switchMode(status);
    }
  }
  const network = createNetworkService({
    paths: {
      start: callback => paths().start(callback),
      stop: () => paths().stop(),
    },
    probe,
    setInterval: deps.setInterval,
    clearInterval: deps.clearInterval,
    emit(status) {
      bus.emit(AppEvent.network, status);
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
    },
  });
  const cloud = createCloudModel({
    url,
    Request: deps.Request,
    now,
    isOnline: () => controller.current().mode === InstructorMode.online,
    onRoundTrip: trip => network.report(trip),
  });
  const instructor = createModelInstructor([cloud, model]);
  const sessions = createInstructorSessions({
    input,
    output,
    agentAvailable: connection.available,
    foreground: foreground.isForeground,
    onPrimaryFailure: primaryFailure,
    networkOffline: () =>
      bus.latest(AppEvent.network)?.quality === NetworkQuality.offline,
    client: handlers =>
      createAgentClient({
        signedUrl: connection.signedUrl,
        connect:
          deps.connect ??
          (address => new WebSocket(address) as unknown as SocketPort),
        audio: (deps.audioLink ?? audioLink)(),
        setTimeout: deps.setTimeout,
        clearTimeout: deps.clearTimeout,
        setInterval: deps.setInterval,
        clearInterval: deps.clearInterval,
        handlers: {
          ...handlers,
          status: value => bus.emit(AppEvent.agent, value),
          roundTrip: ms => network.report({ ok: true, ms }),
        },
      }),
  });
  return {
    instructor,
    voiceSnapshot: () => snapshot,
    subscribeVoice(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
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
      instructorOpen = open;
      network.setActive(open && foreground.isForeground());
    },
    setIdle(value) {
      idle = value;
      controller.setIdle(value && foreground.isForeground());
    },
    start() {
      if (started || disposed) {
        return;
      }
      started = true;
      subscriptions.push(
        bus.on(AppEvent.mode, modeChanged),
        bus.on(AppEvent.modeRequest, request => controller.request(request)),
      );
      foreground.start(active => {
        if (!active) {
          sessions.stop();
          connection.clear();
          instructor.cancel();
        }
        network.setActive(instructorOpen && active);
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
        paths().start(path =>
          bus.emit(AppEvent.network, pathQuality.path(path)),
        );
      } else {
        network.start();
      }
    },
    stop() {
      if (disposed) {
        return;
      }
      disposed = true;
      started = false;
      sessions.stop();
      switchId++;
      connection.clear();
      foreground.stop();
      subscriptions.splice(0).forEach(unsubscribe => unsubscribe());
      switchTimers.forEach(cancel);
      switchTimers.clear();
      if (url === null) {
        paths().stop();
      } else {
        network.stop();
      }
      controller.dispose();
      instructor.cancel();
    },
  };
}
export const instructorRuntime = createInstructorRuntime();
