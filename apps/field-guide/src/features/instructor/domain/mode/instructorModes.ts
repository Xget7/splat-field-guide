import type { NetworkStatus } from '../../../../platform/connectivity/networkStatus';
import type { Utterance } from '../voice/voiceSession';
import { createModeController, type ModeController } from './modeController';
import {
  createModeSwitching,
  type ModeSwitchingOptions,
} from './modeSwitching';
import {
  AnswerSource,
  InstructorMode,
  isSwitching,
  ModeCause,
  VoiceSource,
  type ModeStatus,
  type ModeSuggestion,
} from './modeTypes';

export interface InstructorModesOptions extends ModeSwitchingOptions {
  /** Modes follow switches only between the instructor's start and stop. */
  readonly started: () => boolean;
  readonly onMode: (status: ModeStatus) => void;
  readonly onSuggestion: (suggestion: ModeSuggestion | null) => void;
  /** A switch begins, so the conversation that belongs to the old mode ends. */
  readonly onSwitchStarted: () => void;
  /** The mode changed, with the notice a finished switch speaks. */
  readonly onVoiceChanged: (
    status: ModeStatus,
    announcement: Utterance | null,
  ) => void;
}

export type InstructorModes = Omit<ModeController, 'switched'>;

/**
 * The instructor's mode: the controller's decisions, an offline start that needs no switch, and
 * the switch each switching mode runs before it settles.
 */
export function createInstructorModes(
  options: InstructorModesOptions,
): InstructorModes {
  const { device, started } = options;
  const switching = createModeSwitching(options);
  const controller = createModeController({
    clock: options.clock,
    timers: options.timers,
    emitMode: status => {
      options.onMode(status);
      if (started()) {
        follow(status);
      }
    },
    emitSuggestion: options.onSuggestion,
  });
  let previousMode = controller.current().mode;
  async function follow(status: ModeStatus) {
    if (status.mode === previousMode) {
      return;
    }
    const switched = isSwitching(previousMode);
    previousMode = status.mode;
    if (isSwitching(status.mode)) {
      options.onSwitchStarted();
    }
    options.onVoiceChanged(
      status,
      switched ? switching.announcementFor(status) : null,
    );
    if (isSwitching(status.mode)) {
      const result = await switching.begin(status.mode);
      if (started() && result !== null) {
        controller.switched(result.mode, result.sources);
      }
    }
  }
  return {
    current: controller.current,
    request: controller.request,
    setIdle: controller.setIdle,
    agentAvailable: controller.agentAvailable,
    voiceStarted: controller.voiceStarted,
    network(status: NetworkStatus) {
      controller.network(status);
      const current = controller.current();
      // Starting offline needs no switch, so the mode settles on the device at once.
      if (
        current.mode === InstructorMode.offline &&
        current.cause === ModeCause.startup
      ) {
        controller.switched(InstructorMode.offline, {
          voice: VoiceSource.device,
          answers: device.isReady()
            ? AnswerSource.deviceModel
            : AnswerSource.script,
        });
      }
    },
    dispose() {
      switching.cancel();
      controller.dispose();
    },
  };
}
