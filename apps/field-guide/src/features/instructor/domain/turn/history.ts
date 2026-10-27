/** How many earlier exchanges each way of answering reads, the newest last. */
export const HistoryTurns = {
  /** Claude reads a few exchanges so follow-up questions keep their subject. */
  cloud: 4,
  /** Leaves room in the on-device model's 4096-token window. */
  device: 1,
  /** The voice agent hears the same few exchanges when its conversation opens. */
  agent: 4,
} as const;
