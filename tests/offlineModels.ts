import type { OfflineModelStatus } from 'react-native-on-device';

/** Verified file availability, independent of whether a model is loaded. */
export function offlineModelGroups(
  state: 'checking' | 'missing' | 'ready',
): OfflineModelStatus['models'] {
  return (['answers', 'listening', 'speaking'] as const).map(id => ({
    id,
    state,
    bytes: state === 'ready' ? 100 : 0,
    total: 100,
    progress: state === 'ready' ? 1 : 0,
    error: null,
  }));
}
