import { useInstructorMode } from '../../../features/events/useAppEvent';
import {
  AnswerSource,
  InstructorMode,
  ModeCause,
  ModeRequestType,
  VoiceSource,
} from '../../../features/events/types';
import {
  ModeNoticeCopy,
  ModeToggleCopy,
  SwitchTitle,
} from '../../../features/instructor/mode/modeCopy';
import { Color } from '../../../ui/theme';

export interface Notice {
  readonly title: string;
  readonly detail: string;
  readonly ruleColor: string;
}

const VOICE_FALLBACK: Notice = {
  title: ModeNoticeCopy.voiceFallbackTitle,
  detail: ModeNoticeCopy.voiceFallback,
  ruleColor: Color.lineStrong,
};
const OFFLINE_MODEL: Notice = {
  title: ModeNoticeCopy.offlineTitle,
  detail: ModeNoticeCopy.offlineModel,
  ruleColor: Color.caution,
};
const OFFLINE_SCRIPT: Notice = {
  title: ModeNoticeCopy.offlineTitle,
  detail: ModeNoticeCopy.offlineScript,
  ruleColor: Color.caution,
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

const GO_OFFLINE = {
  label: ModeToggleCopy.goOffline,
  hint: ModeToggleCopy.goOfflineHint,
  requestType: ModeRequestType.forceOffline,
} as const;
const GO_ONLINE = {
  label: ModeToggleCopy.goOnline,
  hint: ModeToggleCopy.goOnlineHint,
  requestType: ModeRequestType.allowOnline,
} as const;

export function toggleFor(forced: boolean) {
  return forced ? GO_ONLINE : GO_OFFLINE;
}

export function useModeView() {
  const status = useInstructorMode();
  const notice = NOTICES[status.mode][status.voice][status.answers];
  const switchTitle = SWITCH_TITLES[status.mode][status.cause];
  return {
    mode: status.mode,
    forced: status.forced,
    notice,
    switchTitle,
    minimizedStatusText: switchTitle ?? notice?.title ?? null,
  };
}
