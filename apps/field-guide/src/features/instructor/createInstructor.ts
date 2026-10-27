import type { Platform } from '../../platform/ports';
import type { Pack } from '../pack/pack';
import type { Instructor } from './domain/instructorHandle';
import { createInstructorModes } from './domain/mode/instructorModes';
import type { OfflineVoice } from './domain/mode/modeSwitching';
import { InstructorMode } from './domain/mode/modeTypes';
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

export type { Instructor };

export interface InstructorOptions {
  readonly platform: Platform;
  /** A null proxy URL runs with on-device answers and voice only. */
  readonly proxyUrl: string | null;
  readonly offlineVoice: OfflineVoice;
  /** Receives every status the instructor reports. */
  readonly store: InstructorStore;
}

export function createInstructor({
  platform,
  proxyUrl,
  offlineVoice,
  store,
}: InstructorOptions): Instructor {
  const { clock, timers } = platform;
  const proxy =
    proxyUrl === null ? null : createProxyClient(proxyUrl, platform);
  const foreground = createInstructorForeground(platform.appState);
  const device = createDeviceAnswerer(platform.languageModel);
  const ids = createExchangeIds();
  let pack: Pack | null = null;
  let started = false;
  let disposed = false;
  let idle = true;
  const modes = createInstructorModes({
    clock,
    timers,
    input: platform.speechInput,
    output: platform.speechOutput,
    offlineVoice,
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
    onShown: status => store.getState().networkChanged(status),
    onMode(status) {
      modes.network(status);
      sessions.networkChanged(status.quality);
    },
  });
  const sessions = createInstructorSessions({
    platform,
    proxy,
    offlineVoice: offlineVoice.voice,
    ids,
    foreground,
    modes,
    network,
    store,
    started: () => started,
  });
  const cloud = createCloudAnswerer({
    proxy,
    clock,
    timers,
    isOnline: () => modes.current().mode === InstructorMode.online,
    onFailure: () => network.report({ ok: false }),
  });
  const turns = createTurnRunner([cloud, device], ids);
  return {
    turns,
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
      foreground.stop();
      network.stop();
      modes.dispose();
      turns.cancel();
    },
  };
}
