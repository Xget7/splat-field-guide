import {
  audioLink,
  networkMonitor,
  speechInput,
  speechOutput,
  type NetworkPath,
} from 'react-native-on-device';
import { appEvents, type EventBus } from '../features/events/bus';
import {
  AgentFailure,
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
import { createQualityEstimator } from '../features/connectivity/networkQuality';
import {
  createNetworkService,
  pingProbe,
} from '../features/connectivity/networkService';
import { createModeController } from '../features/instructor/mode/modeController';
import {
  runSwitch,
  type SwitchPieceTask,
} from '../features/instructor/mode/modeSwitcher';
import { SwitchLabel } from '../features/instructor/mode/modeCopy';
import {
  createAgentClient,
  fetchSignedUrl,
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
import {
  createPipelineVoiceSession,
  VOICE_LOCALE,
} from '../features/instructor/voice/pipelineVoiceSession';
import { createFallbackVoiceSession } from '../features/instructor/voice/fallbackVoiceSession';
import { recognitionHintsFor } from '../features/instructor/voice/recognitionHints';
import {
  VoiceStartFailure,
  type VoiceSession,
} from '../features/instructor/voice/voiceSession';
import type { Pack } from '../features/pack/pack';

export const SIGNED_URL_REUSE_MS = 600000;
const NO_PROXY_REASON = 'no proxy configured';
interface RuntimeDependencies {
  proxyUrl?: string | null;
  appEvents?: EventBus<AppEvents>;
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
export interface InstructorRuntime {
  readonly instructor: ModelInstructor;
  sessionFor(status: ModeStatus, pack: Pack): VoiceSession;
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
  const deviceModel = deps.onDeviceModel ?? onDeviceModel;
  const now = deps.now ?? Date.now;
  const schedule = deps.setTimeout ?? setTimeout;
  const cancel = deps.clearTimeout ?? clearTimeout;
  const switchTimers = new Set<ReturnType<typeof setTimeout>>();
  const pathQuality = createQualityEstimator();
  let pack: Pack | null = null;
  let started = false;
  let switchId = 0;
  let available = url !== null;
  let cached: { url: string; at: number } | null = null;
  let unsubscribe: (() => void) | null = null;
  const noProxy = async () => {
    throw new Error(AgentFailure.network);
  };
  const probe = url === null ? noProxy : pingProbe(url, deps.fetch, now);
  function primaryFailure(failure: VoiceStartFailure) {
    if (
      failure === VoiceStartFailure.quota ||
      failure === VoiceStartFailure.auth
    ) {
      available = false;
      controller.agentAvailable(false);
      bus.emit('agent', { state: AgentState.failed, reason: failure });
    }
  }
  async function signedUrl() {
    if (cached && now() - cached.at < SIGNED_URL_REUSE_MS) {
      const signed = cached.url;
      cached = null;
      return signed;
    }
    cached = null;
    if (url === null || !available) {
      throw new Error(AgentFailure.auth);
    }
    return fetchSignedUrl(url, deps.fetch);
  }
  async function switchMode(status: ModeStatus) {
    const id = ++switchId;
    const offline = status.mode === InstructorMode.switchingToOffline;
    const tasks: SwitchPieceTask[] = offline
      ? [
          {
            piece: 'voice',
            label: SwitchLabel.kokoro,
            fallbackLabel: SwitchLabel.systemVoice,
            start: async () => (await output().prepare('kokoro')) === 'kokoro',
          },
          {
            piece: 'answers',
            label: SwitchLabel.deviceModel,
            fallbackLabel: SwitchLabel.script,
            start: async () => {
              if (pack) {
                deviceModel.prewarm(pack);
              }
              return deviceModel.isReady();
            },
          },
          {
            piece: 'listening',
            label: SwitchLabel.deviceListening,
            fallbackLabel: SwitchLabel.noListening,
            start: async () =>
              (await input().prepare(VOICE_LOCALE)) === 'available',
          },
        ]
      : [
          {
            piece: 'voice',
            label: SwitchLabel.agentVoice,
            fallbackLabel: SwitchLabel.deviceVoice,
            start: async () => {
              if (!available || url === null) {
                return false;
              }
              try {
                const signed = await fetchSignedUrl(url, deps.fetch);
                if (id === switchId && started) {
                  cached = { url: signed, at: now() };
                }
                return true;
              } catch (error) {
                primaryFailure(
                  error instanceof Error && error.message === AgentFailure.quota
                    ? VoiceStartFailure.quota
                    : error instanceof Error &&
                      error.message === AgentFailure.auth
                    ? VoiceStartFailure.auth
                    : VoiceStartFailure.network,
                );
                return false;
              }
            },
          },
          {
            piece: 'answers',
            label: SwitchLabel.claude,
            fallbackLabel: SwitchLabel.deviceModel,
            start: async () => {
              await probe();
              return true;
            },
          },
        ];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const outcome = await runSwitch(
      id,
      tasks,
      step => {
        if (started && id === switchId) {
          bus.emit('switchStep', step);
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
    controller.switched(
      offline ? InstructorMode.offline : InstructorMode.online,
      {
        voice:
          offline || !outcome.voice ? VoiceSource.device : VoiceSource.agent,
        answers: offline
          ? outcome.answers
            ? AnswerSource.deviceModel
            : AnswerSource.script
          : outcome.answers
          ? AnswerSource.claude
          : deviceModel.isReady()
          ? AnswerSource.deviceModel
          : AnswerSource.script,
      },
    );
  }
  const controller = createModeController({
    now,
    setTimeout: deps.setTimeout,
    clearTimeout: deps.clearTimeout,
    emitMode(status) {
      bus.emit('mode', status);
      if (
        status.mode === InstructorMode.switchingToOffline ||
        status.mode === InstructorMode.switchingToOnline
      ) {
        switchMode(status);
      }
    },
    emitSuggestion: value => bus.emit('modeSuggestion', value),
  });
  const network = createNetworkService({
    paths: {
      start: callback => paths().start(callback),
      stop: () => paths().stop(),
    },
    probe,
    setInterval: deps.setInterval,
    clearInterval: deps.clearInterval,
    emit(status) {
      bus.emit('network', status);
      controller.network(status);
      if (
        controller.current().mode === InstructorMode.offline &&
        controller.current().cause === ModeCause.startup
      ) {
        controller.switched(InstructorMode.offline, {
          voice: VoiceSource.device,
          answers: deviceModel.isReady()
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
  const instructor = createModelInstructor([cloud, deviceModel]);
  return {
    instructor,
    sessionFor(status, guide) {
      const pipeline = (voice: 'system' | 'kokoro') =>
        createPipelineVoiceSession({
          voice,
          hints: recognitionHintsFor(guide),
          input,
          output,
        });
      if (status.mode === InstructorMode.offline) {
        return pipeline('kokoro');
      }
      if (status.voice === VoiceSource.device || !available) {
        return pipeline('system');
      }
      return createFallbackVoiceSession({
        primary: createAgentVoiceSession({
          pack: guide,
          client: handlers =>
            createAgentClient({
              signedUrl,
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
                status: value => bus.emit('agent', value),
                roundTrip: ms => network.report({ ok: true, ms }),
              },
            }),
        }),
        fallback: pipeline('system'),
        onPrimaryFailure: primaryFailure,
        networkOffline: () =>
          bus.latest('network')?.quality === NetworkQuality.offline,
      });
    },
    setPack(value) {
      pack = value;
    },
    setInstructorOpen: open => network.setActive(open),
    setIdle: idle => controller.setIdle(idle),
    start() {
      if (started) {
        return;
      }
      started = true;
      controller.agentAvailable(available);
      unsubscribe = bus.on('modeRequest', request =>
        controller.request(request),
      );
      if (url === null) {
        controller.network({
          quality: NetworkQuality.offline,
          transport: Transport.none,
          reason: NO_PROXY_REASON,
        });
        controller.switched(InstructorMode.offline, {
          voice: VoiceSource.device,
          answers: deviceModel.isReady()
            ? AnswerSource.deviceModel
            : AnswerSource.script,
        });
        paths().start(path => bus.emit('network', pathQuality.path(path)));
      } else {
        network.start();
      }
    },
    stop() {
      started = false;
      switchId++;
      cached = null;
      unsubscribe?.();
      unsubscribe = null;
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
