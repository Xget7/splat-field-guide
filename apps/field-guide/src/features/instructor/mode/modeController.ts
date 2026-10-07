import {
  AnswerSource,
  InstructorMode,
  ModeCause,
  ModeRequestType,
  NetworkQuality,
  VoiceSource,
  type ModeRequest,
  type ModeStatus,
  type ModeSuggestion,
  type NetworkStatus,
} from '../../events/types';

export const ModeTiming = {
  RECOVERY_MS: 10000,
  SUGGESTION_SNOOZE_MS: 300000,
} as const;
export const SuggestionReason = { weak: 'Weak signal' } as const;
export interface ModeControllerOptions {
  readonly emitMode: (status: ModeStatus) => void;
  readonly emitSuggestion: (suggestion: ModeSuggestion | null) => void;
  readonly now?: () => number;
  readonly setTimeout?: typeof setTimeout;
  readonly clearTimeout?: typeof clearTimeout;
}
export interface ModeController {
  current(): ModeStatus;
  network(status: NetworkStatus): void;
  request(request: ModeRequest): void;
  setIdle(idle: boolean): void;
  agentAvailable(available: boolean): void;
  switched(
    mode: typeof InstructorMode.online | typeof InstructorMode.offline,
    sources: { voice: VoiceSource; answers: AnswerSource },
  ): void;
}
export function createModeController(
  options: ModeControllerOptions,
): ModeController {
  const now = options.now ?? Date.now;
  const schedule = options.setTimeout ?? setTimeout;
  const cancel = options.clearTimeout ?? clearTimeout;
  let status: ModeStatus = {
    mode: InstructorMode.online,
    cause: ModeCause.startup,
    voice: VoiceSource.agent,
    answers: AnswerSource.claude,
    forced: false,
  };
  let initialized = false;
  let quality: NetworkQuality = NetworkQuality.good;
  let idle = true;
  let available = true;
  let suggestion = false;
  let snoozedUntil = 0;
  let recovery: ReturnType<typeof setTimeout> | null = null;
  let recovered = false;
  let userOffline = false;
  let userOnline = false;
  const switching = () =>
    status.mode === InstructorMode.switchingToOffline ||
    status.mode === InstructorMode.switchingToOnline;
  function emit(next: ModeStatus, first = false) {
    if (
      first ||
      Object.keys(next).some(
        key =>
          next[key as keyof ModeStatus] !== status[key as keyof ModeStatus],
      )
    ) {
      status = { ...next };
      options.emitMode(status);
    }
  }
  function suggest(show: boolean) {
    if (suggestion === show) {
      return;
    }
    suggestion = show;
    options.emitSuggestion(
      show
        ? { mode: InstructorMode.offline, reason: SuggestionReason.weak }
        : null,
    );
  }
  function cancelRecovery() {
    if (recovery !== null) {
      cancel(recovery);
      recovery = null;
    }
    recovered = false;
  }
  function begin(
    mode:
      | typeof InstructorMode.switchingToOffline
      | typeof InstructorMode.switchingToOnline,
    cause: ModeCause,
  ) {
    suggest(false);
    cancelRecovery();
    userOnline = false;
    userOffline = false;
    emit({ ...status, mode, cause });
  }
  function evaluate() {
    if (!initialized || switching()) {
      return;
    }
    if (status.mode === InstructorMode.online) {
      cancelRecovery();
      if (status.forced || userOffline) {
        begin(InstructorMode.switchingToOffline, ModeCause.user);
      } else if (quality === NetworkQuality.offline) {
        begin(InstructorMode.switchingToOffline, ModeCause.network);
      } else {
        suggest(quality === NetworkQuality.weak && now() >= snoozedUntil);
      }
      return;
    }
    suggest(false);
    userOffline = false;
    const onlineRequested = userOnline;
    userOnline = false;
    if (
      onlineRequested &&
      !status.forced &&
      quality === NetworkQuality.good &&
      idle
    ) {
      begin(InstructorMode.switchingToOnline, ModeCause.user);
      return;
    }
    if (status.forced || quality !== NetworkQuality.good) {
      cancelRecovery();
      return;
    }
    if (idle && recovered) {
      begin(InstructorMode.switchingToOnline, ModeCause.recovered);
      return;
    }
    if (!recovered && recovery === null) {
      recovery = schedule(() => {
        recovery = null;
        recovered = true;
        evaluate();
      }, ModeTiming.RECOVERY_MS);
    }
  }
  return {
    current: () => status,
    network(next) {
      quality = next.quality;
      if (!initialized) {
        initialized = true;
        const offline = quality === NetworkQuality.offline || status.forced;
        emit(
          {
            ...status,
            mode: offline ? InstructorMode.offline : InstructorMode.online,
            cause: ModeCause.startup,
            voice:
              offline || !available ? VoiceSource.device : VoiceSource.agent,
            answers: offline ? AnswerSource.deviceModel : AnswerSource.claude,
          },
          true,
        );
      }
      evaluate();
    },
    request(request) {
      switch (request.type) {
        case ModeRequestType.dismissSuggestion:
          suggest(false);
          snoozedUntil = now() + ModeTiming.SUGGESTION_SNOOZE_MS;
          schedule(evaluate, ModeTiming.SUGGESTION_SNOOZE_MS);
          break;
        case ModeRequestType.acceptSuggestion:
          suggest(false);
          userOffline = true;
          userOnline = false;
          emit({ ...status, forced: false });
          break;
        case ModeRequestType.forceOffline:
          userOffline = true;
          userOnline = false;
          emit({ ...status, forced: true });
          break;
        case ModeRequestType.allowOnline:
          userOffline = false;
          userOnline = true;
          emit({ ...status, forced: false });
          break;
      }
      evaluate();
    },
    setIdle(value) {
      idle = value;
      evaluate();
    },
    agentAvailable(value) {
      available = value;
      if (status.mode === InstructorMode.online) {
        emit({
          ...status,
          voice: available ? VoiceSource.agent : VoiceSource.device,
        });
      }
    },
    switched(mode, sources) {
      emit({
        ...status,
        mode,
        ...sources,
        voice:
          mode === InstructorMode.online && !available
            ? VoiceSource.device
            : sources.voice,
      });
      evaluate();
    },
  };
}
