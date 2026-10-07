import { AppState, type AppStateStatus } from 'react-native';
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
import { createAgentVoiceSession } from '../features/instructor/voice/agentVoiceSession';
import { createPipelineVoiceSession } from '../features/instructor/voice/pipelineVoiceSession';
import { createFallbackVoiceSession } from '../features/instructor/voice/fallbackVoiceSession';
import { recognitionHintsFor } from '../features/instructor/voice/recognitionHints';
import {
  VoiceStartFailure,
  type VoiceConnection,
  type VoiceRuntime,
  type VoiceRuntimeState,
  type VoiceSession,
} from '../features/instructor/voice/voiceSession';
import { SpeechVoice } from '../features/instructor/voice/voiceCopy';
import { voiceFailure } from '../features/instructor/voice/voiceFailure';
import type { Pack } from '../features/pack/pack';
import { createAgentConnection } from './agentConnection';
import {
  offlineAnnouncement,
  switchSources,
  switchTasks,
} from './instructorSwitch';

const AppActivity = { active: 'active', change: 'change' } as const;
interface AppStatePort {
  readonly currentState: string | null;
  addEventListener(
    event: typeof AppActivity.change,
    listener: (state: AppStateStatus) => void,
  ): { remove(): void };
}
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
  const activity: AppStatePort = deps.appState ?? {
    currentState: AppState.currentState ?? null,
    addEventListener: (event, listener) =>
      AppState.addEventListener(event, state => {
        if (state !== undefined) {
          listener(state);
        }
      }),
  };
  const model = deps.onDeviceModel ?? onDeviceModel;
  const now = deps.now ?? Date.now;
  const schedule = deps.setTimeout ?? setTimeout;
  const cancel = deps.clearTimeout ?? clearTimeout;
  const connection = createAgentConnection({ url, fetchImpl: deps.fetch, now });
  const switchTimers = new Set<ReturnType<typeof setTimeout>>();
  const sessions = new Set<VoiceSession>();
  const listeners = new Set<() => void>();
  const subscriptions: (() => void)[] = [];
  const pathQuality = createQualityEstimator();
  let pack: Pack | null = null;
  let started = false;
  let disposed = false;
  let switchId = 0;
  let foreground =
    activity.currentState === null ||
    activity.currentState === AppActivity.active;
  let idle = true;
  let instructorOpen = false;
  let snapshot: VoiceRuntimeState = {
    revision: 0,
    canStart: foreground,
    foreground,
    announcement: null,
  };
  function stopSessions() {
    for (const session of [...sessions]) {
      session.stop();
    }
  }
  function publishVoice(status: ModeStatus, switched = false) {
    const canStart = foreground && !isSwitching(status.mode);
    snapshot = {
      revision: snapshot.revision + 1,
      canStart,
      foreground,
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
        if (!foreground || !connection.available()) {
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
      stopSessions();
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
        return sessions.has(session) && foreground ? voice.questions : null;
      },
    };
  }
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
      const status = controller.current();
      const pipeline = (
        voice: (typeof SpeechVoice)[keyof typeof SpeechVoice],
      ): VoiceConnection => ({
        session: createPipelineVoiceSession({
          voice,
          hints: recognitionHintsFor(guide),
          input,
          output,
        }),
        questions: null,
      });
      if (status.mode === InstructorMode.offline) {
        return own(pipeline(SpeechVoice.kokoro));
      }
      if (status.voice === VoiceSource.device || !connection.available()) {
        return own(pipeline(SpeechVoice.system));
      }
      const primary = createAgentVoiceSession({
        pack: guide,
        input,
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
      const fallback = createFallbackVoiceSession({
        primary,
        primaryQuestions: primary,
        fallback: pipeline(SpeechVoice.system).session,
        onPrimaryFailure: primaryFailure,
        networkOffline: () =>
          bus.latest(AppEvent.network)?.quality === NetworkQuality.offline,
      });
      return own({
        session: fallback,
        get questions() {
          return fallback.questions;
        },
      });
    },
    setPack(value) {
      pack = value;
    },
    setInstructorOpen(open) {
      instructorOpen = open;
      network.setActive(open && foreground);
    },
    setIdle(value) {
      idle = value;
      controller.setIdle(value && foreground);
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
      const subscription = activity.addEventListener(
        AppActivity.change,
        state => {
          const active = state === AppActivity.active;
          if (active === foreground) {
            return;
          }
          foreground = active;
          if (!foreground) {
            stopSessions();
            connection.clear();
            instructor.cancel();
            network.setActive(false);
          }
          if (foreground) {
            network.setActive(instructorOpen);
          }
          controller.setIdle(idle && foreground);
          publishVoice(controller.current());
        },
      );
      subscriptions.push(() => subscription.remove());
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
      stopSessions();
      switchId++;
      connection.clear();
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
