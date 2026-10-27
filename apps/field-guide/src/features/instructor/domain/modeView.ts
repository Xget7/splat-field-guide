import { ModeNoticeCopy, SwitchTitle } from './mode/modeCopy';
import {
  AnswerSource,
  InstructorMode,
  ModeCause,
  VoiceSource,
  type ModeStatus,
} from './mode/modeTypes';

/** How a notice's rule reads; presentation picks the colour. */
export const NoticeTone = { plain: 'plain', caution: 'caution' } as const;
export type NoticeTone = (typeof NoticeTone)[keyof typeof NoticeTone];

export interface Notice {
  readonly title: string;
  readonly detail: string;
  readonly tone: NoticeTone;
}

export interface ModeView {
  readonly mode: InstructorMode;
  readonly notice: Notice | null;
  readonly switchTitle: string | null;
  readonly minimizedStatusText: string | null;
}

const VOICE_FALLBACK: Notice = {
  title: ModeNoticeCopy.voiceFallbackTitle,
  detail: ModeNoticeCopy.voiceFallback,
  tone: NoticeTone.plain,
};
const OFFLINE_MODEL: Notice = {
  title: ModeNoticeCopy.offlineTitle,
  detail: ModeNoticeCopy.offlineModel,
  tone: NoticeTone.caution,
};
const OFFLINE_SCRIPT: Notice = {
  title: ModeNoticeCopy.offlineTitle,
  detail: ModeNoticeCopy.offlineScript,
  tone: NoticeTone.caution,
};
const NO_NOTICE = { claude: null, deviceModel: null, script: null } as const;
const ONLINE_DEVICE = {
  claude: VOICE_FALLBACK,
  deviceModel: VOICE_FALLBACK,
  script: VOICE_FALLBACK,
} as const;
const OFFLINE_NOTICES = {
  claude: OFFLINE_SCRIPT,
  deviceModel: OFFLINE_MODEL,
  script: OFFLINE_SCRIPT,
} as const;
const NOTICES: Readonly<
  Record<
    InstructorMode,
    Readonly<Record<VoiceSource, Readonly<Record<AnswerSource, Notice | null>>>>
  >
> = {
  online: { agent: NO_NOTICE, device: ONLINE_DEVICE },
  offline: { agent: OFFLINE_NOTICES, device: OFFLINE_NOTICES },
  switchingToOffline: { agent: NO_NOTICE, device: NO_NOTICE },
  switchingToOnline: { agent: NO_NOTICE, device: NO_NOTICE },
};
const NO_SWITCH_TITLE = {
  startup: null,
  network: null,
  user: null,
  recovered: null,
} as const;
const SWITCH_TITLES: Readonly<
  Record<InstructorMode, Readonly<Record<ModeCause, string | null>>>
> = {
  online: NO_SWITCH_TITLE,
  offline: NO_SWITCH_TITLE,
  switchingToOffline: {
    startup: SwitchTitle.toOffline,
    network: SwitchTitle.lostConnection,
    user: SwitchTitle.toOffline,
    recovered: SwitchTitle.toOffline,
  },
  switchingToOnline: {
    startup: SwitchTitle.toOnlineByUser,
    network: SwitchTitle.toOnlineByUser,
    user: SwitchTitle.toOnlineByUser,
    recovered: SwitchTitle.toOnline,
  },
};

/** The notice and switch title the instructor shows for its current mode. */
export function modeViewFor(status: ModeStatus): ModeView {
  const baseNotice = NOTICES[status.mode][status.voice][status.answers];
  const notice =
    status.mode === InstructorMode.offline && baseNotice !== null
      ? {
          ...baseNotice,
          detail: baseNotice.detail + ' ' + ModeNoticeCopy.offlineRecovery,
        }
      : baseNotice;
  const switchTitle = SWITCH_TITLES[status.mode][status.cause];
  return {
    mode: status.mode,
    notice,
    switchTitle,
    minimizedStatusText: switchTitle ?? notice?.title ?? null,
  };
}
