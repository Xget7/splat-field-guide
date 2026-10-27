export const AgentState = {
  idle: 'idle',
  connecting: 'connecting',
  connected: 'connected',
  ended: 'ended',
  failed: 'failed',
} as const;
export type AgentState = (typeof AgentState)[keyof typeof AgentState];

export const ConnectionFailure = {
  quota: 'quota',
  auth: 'auth',
  network: 'network',
} as const;
export type ConnectionFailure =
  (typeof ConnectionFailure)[keyof typeof ConnectionFailure];
export const AgentFailure = {
  ...ConnectionFailure,
  unknown: 'unknown',
} as const;
export type AgentFailure = (typeof AgentFailure)[keyof typeof AgentFailure];

export interface AgentStatus {
  readonly state: AgentState;
  readonly reason: AgentFailure | null;
}
