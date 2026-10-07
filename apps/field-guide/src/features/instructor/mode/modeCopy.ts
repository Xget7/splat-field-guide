export const SwitchTitle = {
  lostConnection: 'Connection lost. Switching to offline.',
  toOffline: 'Switching to offline.',
  toOnline: 'Back online. Switching to online voice.',
  toOnlineByUser: 'Switching to online voice.',
} as const;

export const SwitchLabel = {
  kokoro: 'Voice: Kokoro',
  systemVoice: 'Voice: system voice',
  deviceModel: 'Answers: on-device model',
  script: 'Answers: guide script',
  deviceListening: 'Listening: on device',
  noListening: 'Listening: unavailable, type instead',
  agentVoice: 'Voice: ElevenLabs',
  deviceVoice: 'Voice: on-device voice',
  claude: 'Answers: Claude',
} as const;

export const ModeNoticeCopy = {
  offlineTitle: 'Offline',
  offlineModel:
    'Answers come from the on-device model, which this device limits. Keep questions short.',
  offlineScript: "Answers come from the guide's script.",
  voiceFallbackTitle: 'Online voice unavailable',
  voiceFallback: 'Using on-device voice.',
} as const;

export const SuggestionCopy = {
  title: 'Weak signal',
  body: 'Switch to offline?',
  accept: 'Switch',
  dismiss: 'Keep online',
} as const;

export const ModeToggleCopy = {
  goOffline: 'Go offline',
  goOnline: 'Go online',
} as const;

/** Said by the offline voice after a switch caused by the network. */
export const ModeAnnouncement = {
  deviceModel: 'Offline. Answers come from the on-device model.',
  script: "Offline. Answers come from the guide's script.",
} as const;

export const InterruptedLabel = 'Interrupted';
