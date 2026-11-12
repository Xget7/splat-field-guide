import { createOfflinePreparation } from './data/runtime/offlinePreparation';
import type { Platform } from '../../platform/ports';
import type { Pack } from '../pack/pack';
import type { Instructor } from './domain/instructorHandle';
import { createInstructorModes } from './domain/mode/instructorModes';
import { InstructorMode } from './domain/mode/modeTypes';
import { TurnEventType, type TurnEvent } from './domain/turn/exchange';
import type { PreviousExchange } from './domain/grounding';
import { createExchangeIds } from './domain/turn/exchange';
import { createTurnRunner } from './domain/turn/turnRunner';
import { VoiceStartFailure } from './domain/voice/voiceSession';
import { createCloudAnswerer } from './data/answerers/cloudAnswerer';
import { createDeviceAnswerer } from './data/answerers/deviceAnswerer';
import { createProxyClient } from './data/proxy/proxyClient';
import { createInstructorForeground } from './data/runtime/instructorForeground';
import { createInstructorNetwork } from './data/runtime/instructorNetwork';
import { createInstructorSessions } from './data/runtime/instructorSessions';
import type { InstructorStore } from './state/instructorStore';
import type { KnowledgeLoader } from './domain/agent/agentTools';

export type { Instructor };

export interface InstructorOptions {
  readonly platform: Platform;
  readonly knowledge?: KnowledgeLoader;
  /** A null proxy URL runs with on-device answers and voice only. */
  readonly proxyUrl: string | null;
  /** Receives every status the instructor reports. */
  readonly store: InstructorStore;
}

export function createInstructor({
  platform,
  knowledge,
  proxyUrl,
  store,
}: InstructorOptions): Instructor {
  const { clock, timers } = platform;
  const proxy =
    proxyUrl === null ? null : createProxyClient(proxyUrl, platform);
  const foreground = createInstructorForeground(platform.appState);
  const device = createDeviceAnswerer(platform.languageModel);
  const ids = createExchangeIds();
  const history = new Map<string, Map<number, PreviousExchange>>();
  const keyFor = (value: Pack) => `${value.packId}/${value.packVersion}`;
  const historyFor = (value: Pack) =>
    [...(history.get(keyFor(value))?.values() ?? [])].slice(-12);
  const remember = (value: Pack, event: TurnEvent) => {
    if (event.type !== TurnEventType.answer || event.exchange.interrupted)
      return;
    const key = keyFor(value);
    const entries = history.get(key) ?? new Map<number, PreviousExchange>();
    entries.set(event.exchange.id, {
      question: event.exchange.question,
      reply: event.exchange.reply,
    });
    while (entries.size > 12) entries.delete(entries.keys().next().value!);
    history.set(key, entries);
  };
  let pack: Pack | null = null;
  let started = false;
  let disposed = false;
  let idle = true;
  let preparation: ReturnType<typeof createOfflinePreparation> | null = null;
  let unsubscribeModels: (() => void) | null = null;
  const modes = createInstructorModes({
    clock,
    timers,
    input: platform.speechInput,
    output: platform.speechOutput,
    device,
    pack: () => pack,
    prepareAgent: () => sessions.prepareAgent(),
    probe:
      proxy?.ping ??
      (() => Promise.reject(new Error(VoiceStartFailure.network))),
    started: () => started,
    onMode: status => store.getState().modeChanged(status),
    onSuggestion: value => store.getState().suggestionChanged(value),
    onStep: step => store.getState().switchStepArrived(step),
    onSwitchStarted: () => sessions.stop(),
    onVoiceChanged: (status, notice) => sessions.publish(status, notice),
  });
  const network = createInstructorNetwork({
    platform,
    proxy,
    onPath: path => {
      store.getState().networkRouteChanged(path.satisfied);
      preparation?.path(path.satisfied);
    },
    onShown: status => store.getState().networkChanged(status),
    onMode(status) {
      modes.network(status);
      sessions.networkChanged(status.quality);
    },
  });
  const sessions = createInstructorSessions({
    platform,
    proxy,
    ids,
    foreground,
    modes,
    network,
    store,
    started: () => started,
    historyFor,
    remember,
    knowledge,
  });
  const cloud = createCloudAnswerer({
    proxy,
    socket: platform.socket,
    knowledge,
    clock,
    timers,
    isOnline: () => modes.current().mode === InstructorMode.online,
    onFailure: () => network.report({ ok: false }),
  });
  const runner = createTurnRunner([cloud, device], ids, knowledge);
  const turns: typeof runner = {
    ...runner,
    ask: (input, changed) =>
      runner.ask(
        {
          ...input,
          history: input.history.length
            ? input.history
            : historyFor(input.pack),
        },
        event => {
          remember(input.pack, event);
          changed(event);
        },
      ),
  };
  return {
    turns,
    historyFor,
    get offlineModels() {
      return platform.offlineModels?.();
    },
    sessionFor: guide => (disposed ? null : sessions.sessionFor(guide)),
    setPack(value) {
      pack = value;
    },
    setInstructorOpen: open => network.setActive(open),
    setIdle(value) {
      idle = value;
      modes.setIdle(value && foreground.isForeground());
      sessions.setIdle(value);
    },
    requestMode(request) {
      if (started) {
        modes.request(request);
      }
    },
    start() {
      if (started || disposed) {
        return;
      }
      started = true;
      const models = platform.offlineModels?.();
      if (models) {
        let ready = device.isReady();
        unsubscribeModels = models.subscribe(() => {
          const nextReady = device.isReady();
          if (nextReady === ready) {
            return;
          }
          ready = nextReady;
          if (started) {
            modes.refreshDevice();
            sessions.publish(modes.current());
          }
        });
        preparation = createOfflinePreparation(models);
        preparation.start();
      }
      foreground.start(active => {
        if (!active) {
          sessions.stop();
          turns.cancel();
        }
        network.setForeground(active);
        modes.setIdle(idle && active);
        sessions.publish(modes.current());
      });
      modes.agentAvailable(sessions.agentAvailable());
      network.setForeground(foreground.isForeground());
      network.start();
    },
    stop() {
      if (disposed) {
        return;
      }
      disposed = true;
      started = false;
      sessions.stop();
      unsubscribeModels?.();
      preparation?.stop();
      platform.offlineModels?.().release();
      foreground.stop();
      network.stop();
      modes.dispose();
      turns.cancel();
    },
  };
}
