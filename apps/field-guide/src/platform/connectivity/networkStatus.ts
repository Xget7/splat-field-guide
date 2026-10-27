export const NetworkReason = { unknown: 'unknown' } as const;
export type NetworkReason = (typeof NetworkReason)[keyof typeof NetworkReason];

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
