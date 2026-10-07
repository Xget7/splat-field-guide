export const NetworkQuality = {
  good: 'good',
  weak: 'weak',
  offline: 'offline',
} as const;
export type NetworkQuality =
  (typeof NetworkQuality)[keyof typeof NetworkQuality];

export const Transport = {
  wifi: 'wifi',
  cellular: 'cellular',
  wired: 'wired',
  other: 'other',
  none: 'none',
} as const;
export type Transport = (typeof Transport)[keyof typeof Transport];

export interface NetworkStatus {
  readonly quality: NetworkQuality;
  readonly transport: Transport;
  /** Why the estimator chose this quality, for logs and tests. */
  readonly reason: string;
}

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

export interface ModeStatus {
  readonly mode: InstructorMode;
  readonly cause: ModeCause;
  readonly voice: VoiceSource;
  readonly answers: AnswerSource;
  /** The user turned offline on, so the app does not return online by itself. */
  readonly forced: boolean;
}

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

export const AgentState = {
  idle: 'idle',
  connecting: 'connecting',
  connected: 'connected',
  ended: 'ended',
  failed: 'failed',
} as const;
export type AgentState = (typeof AgentState)[keyof typeof AgentState];

export const AgentFailure = {
  quota: 'quota',
  auth: 'auth',
  network: 'network',
  unknown: 'unknown',
} as const;
export type AgentFailure = (typeof AgentFailure)[keyof typeof AgentFailure];

export interface AgentStatus {
  readonly state: AgentState;
  readonly reason: AgentFailure | null;
}

export const ModeRequestType = {
  forceOffline: 'forceOffline',
  allowOnline: 'allowOnline',
  acceptSuggestion: 'acceptSuggestion',
  dismissSuggestion: 'dismissSuggestion',
} as const;
export type ModeRequest = {
  readonly type: (typeof ModeRequestType)[keyof typeof ModeRequestType];
};

export interface AppEvents {
  network: NetworkStatus;
  mode: ModeStatus;
  switchStep: SwitchStep;
  modeSuggestion: ModeSuggestion | null;
  agent: AgentStatus;
  /** User intents from the UI; the mode controller listens. */
  modeRequest: ModeRequest;
}
