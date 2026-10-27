import {
  NetworkQuality,
  type NetworkStatus,
} from '../../../../platform/connectivity/networkStatus';
import {
  AnswerSource,
  InstructorMode,
  ModeCause,
  ModeRequestType,
  STARTUP_MODE,
  VoiceSource,
  type ModeRequest,
  type ModeStatus,
  type ModeSources,
  type ModeSuggestion,
} from './modeTypes';
import type { Cancel, Clock, Timers } from '../../../../platform/ports';

export const ModeTiming = {
  RECOVERY_MS: 10000,
  // A connection lost again this soon after recovering doubles the next wait, up to the maximum.
  STABLE_MS: 120000,
  MAX_RECOVERY_MS: 120000,
  SUGGESTION_DELAY_MS: 5000,
  SUGGESTION_SNOOZE_MS: 300000,
} as const;
export const SuggestionReason = { weak: 'weak' } as const;
export type SuggestionReason =
  (typeof SuggestionReason)[keyof typeof SuggestionReason];
export interface ModeControllerOptions {
  readonly emitMode: (status: ModeStatus) => void;
  readonly emitSuggestion: (suggestion: ModeSuggestion | null) => void;
  readonly clock: Clock;
  readonly timers: Timers;
}
export interface ModeController {
  current(): ModeStatus;
  dispose(): void;
  network(status: NetworkStatus): void;
  request(request: ModeRequest): void;
  setIdle(idle: boolean): void;
  agentAvailable(available: boolean): void;
  voiceStarted(voice: VoiceSource): void;
  switched(
    mode: typeof InstructorMode.online | typeof InstructorMode.offline,
    sources: ModeSources,
  ): void;
}
export function createModeController(
  options: ModeControllerOptions,
): ModeController {
  const { clock: now, timers } = options;
  let status: ModeStatus = STARTUP_MODE;
  let initialized = false;
  let disposed = false;
  let quality: NetworkQuality = NetworkQuality.good;
  let idle = true;
  let available = true;
  let suggestion = false;
  let weakSince: number | null = null;
  let goodSince: number | null = null;
  let cancelSuggestionWait: Cancel | null = null;
  let cancelWithdrawalWait: Cancel | null = null;
  let cancelSnooze: Cancel | null = null;
  let snoozedUntil = 0;
  let cancelRecoveryWait: Cancel | null = null;
  let recovered = false;
  let recoveryMs: number = ModeTiming.RECOVERY_MS;
  let recoveredAt: number | null = null;
  let userOffline = false;
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
  function clearSuggestionTimers() {
    if (cancelSuggestionWait !== null) {
      cancelSuggestionWait();
      cancelSuggestionWait = null;
    }
    if (cancelWithdrawalWait !== null) {
      cancelWithdrawalWait();
      cancelWithdrawalWait = null;
    }
  }
  function updateSuggestion() {
    if (quality === NetworkQuality.weak) {
      if (cancelWithdrawalWait !== null) {
        cancelWithdrawalWait();
        cancelWithdrawalWait = null;
      }
      if (suggestion || now() < snoozedUntil) {
        return;
      }
      const remaining =
        ModeTiming.SUGGESTION_DELAY_MS - (now() - (weakSince ?? now()));
      if (remaining <= 0) {
        suggest(true);
      } else if (cancelSuggestionWait === null) {
        cancelSuggestionWait = timers.after(remaining, () => {
          cancelSuggestionWait = null;
          evaluate();
        });
      }
    } else {
      if (cancelSuggestionWait !== null) {
        cancelSuggestionWait();
        cancelSuggestionWait = null;
      }
      if (suggestion && cancelWithdrawalWait === null) {
        const remaining =
          ModeTiming.RECOVERY_MS - (now() - (goodSince ?? now()));
        if (remaining <= 0) {
          suggest(false);
        } else {
          cancelWithdrawalWait = timers.after(remaining, () => {
            cancelWithdrawalWait = null;
            evaluate();
          });
        }
      }
    }
  }
  function cancelRecovery() {
    if (cancelRecoveryWait !== null) {
      cancelRecoveryWait();
      cancelRecoveryWait = null;
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
    clearSuggestionTimers();
    cancelRecovery();
    userOffline = false;
    emit({ ...status, mode, cause });
  }
  function evaluate() {
    if (disposed || !initialized || switching()) {
      return;
    }
    if (status.mode === InstructorMode.online) {
      cancelRecovery();
      if (userOffline) {
        begin(InstructorMode.switchingToOffline, ModeCause.user);
      } else if (quality === NetworkQuality.offline) {
        const unstable =
          recoveredAt !== null && now() - recoveredAt < ModeTiming.STABLE_MS;
        recoveryMs = unstable
          ? Math.min(recoveryMs * 2, ModeTiming.MAX_RECOVERY_MS)
          : ModeTiming.RECOVERY_MS;
        recoveredAt = null;
        begin(InstructorMode.switchingToOffline, ModeCause.network);
      } else {
        updateSuggestion();
      }
      return;
    }
    suggest(false);
    clearSuggestionTimers();
    userOffline = false;
    if (quality !== NetworkQuality.good) {
      cancelRecovery();
      return;
    }
    if (idle && recovered) {
      begin(InstructorMode.switchingToOnline, ModeCause.recovered);
      return;
    }
    if (!recovered && cancelRecoveryWait === null) {
      cancelRecoveryWait = timers.after(recoveryMs, () => {
        cancelRecoveryWait = null;
        recovered = true;
        evaluate();
      });
    }
  }
  return {
    current: () => status,
    dispose() {
      disposed = true;
      cancelRecovery();
      clearSuggestionTimers();
      if (cancelSnooze !== null) {
        cancelSnooze();
        cancelSnooze = null;
      }
    },
    network(next) {
      if (disposed) {
        return;
      }
      if (next.quality !== quality || !initialized) {
        weakSince = next.quality === NetworkQuality.weak ? now() : null;
        goodSince = next.quality === NetworkQuality.good ? now() : null;
      }
      quality = next.quality;
      if (!initialized) {
        initialized = true;
        const offline = quality === NetworkQuality.offline;
        emit(
          {
            ...status,
            mode: offline ? InstructorMode.offline : InstructorMode.online,
            cause: ModeCause.startup,
            voice: offline || !available ? VoiceSource.device : status.voice,
            answers: offline ? AnswerSource.deviceModel : AnswerSource.claude,
          },
          true,
        );
      }
      evaluate();
    },
    request(request) {
      if (disposed) {
        return;
      }
      switch (request.type) {
        case ModeRequestType.dismissSuggestion:
          suggest(false);
          clearSuggestionTimers();
          snoozedUntil = now() + ModeTiming.SUGGESTION_SNOOZE_MS;
          if (cancelSnooze !== null) {
            cancelSnooze();
          }
          cancelSnooze = timers.after(ModeTiming.SUGGESTION_SNOOZE_MS, () => {
            cancelSnooze = null;
            evaluate();
          });
          break;
        case ModeRequestType.acceptSuggestion:
          suggest(false);
          userOffline = true;
          break;
      }
      evaluate();
    },
    setIdle(value) {
      if (disposed) {
        return;
      }
      idle = value;
      evaluate();
    },
    agentAvailable(value) {
      if (disposed) {
        return;
      }
      available = value;
      if (status.mode === InstructorMode.online) {
        emit({
          ...status,
          voice: available ? VoiceSource.agent : VoiceSource.device,
        });
      }
    },
    voiceStarted(voice) {
      if (
        disposed ||
        status.mode !== InstructorMode.online ||
        (voice === VoiceSource.agent && !available)
      ) {
        return;
      }
      emit({ ...status, voice });
    },
    switched(mode, sources) {
      if (disposed) {
        return;
      }
      recoveredAt =
        mode === InstructorMode.online && status.cause === ModeCause.recovered
          ? now()
          : null;
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
