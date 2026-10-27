export const InstructorMode = {
  online: 'online',
  switchingToOffline: 'switchingToOffline',
  offline: 'offline',
  switchingToOnline: 'switchingToOnline',
} as const;
export type InstructorMode =
  (typeof InstructorMode)[keyof typeof InstructorMode];

export const ModeCause = {
  startup: 'startup',
  network: 'network',
  user: 'user',
  recovered: 'recovered',
} as const;
export type ModeCause = (typeof ModeCause)[keyof typeof ModeCause];

/** Who speaks and listens: the ElevenLabs agent, or the on-device pipeline. */
export const VoiceSource = { agent: 'agent', device: 'device' } as const;
export type VoiceSource = (typeof VoiceSource)[keyof typeof VoiceSource];

export const AnswerSource = {
  claude: 'claude',
  deviceModel: 'deviceModel',
  script: 'script',
} as const;
export type AnswerSource = (typeof AnswerSource)[keyof typeof AnswerSource];

export interface ModeSources {
  readonly voice: VoiceSource;
  readonly answers: AnswerSource;
}
export interface ModeStatus extends ModeSources {
  readonly mode: InstructorMode;
  readonly cause: ModeCause;
}
/** The mode before the first network status: online with the agent and Claude. */
export const STARTUP_MODE: ModeStatus = {
  mode: InstructorMode.online,
  cause: ModeCause.startup,
  voice: VoiceSource.agent,
  answers: AnswerSource.claude,
};

export const SwitchPiece = {
  voice: 'voice',
  answers: 'answers',
  listening: 'listening',
} as const;
export type SwitchPiece = (typeof SwitchPiece)[keyof typeof SwitchPiece];

export const SwitchStepState = {
  starting: 'starting',
  ready: 'ready',
  fallback: 'fallback',
} as const;
export type SwitchStepState =
  (typeof SwitchStepState)[keyof typeof SwitchStepState];

export interface SwitchStep {
  /** Increases with every switch, so a late step from an earlier switch is ignored. */
  readonly switchId: number;
  readonly piece: SwitchPiece;
  readonly state: SwitchStepState;
  readonly label: string;
}

export interface ModeSuggestion {
  readonly mode: typeof InstructorMode.offline;
  readonly reason: string;
}

export const ModeRequestType = {
  acceptSuggestion: 'acceptSuggestion',
  dismissSuggestion: 'dismissSuggestion',
} as const;
export type ModeRequest = {
  readonly type: (typeof ModeRequestType)[keyof typeof ModeRequestType];
};

export function isSwitching(mode: InstructorMode): boolean {
  return (
    mode === InstructorMode.switchingToOffline ||
    mode === InstructorMode.switchingToOnline
  );
}
