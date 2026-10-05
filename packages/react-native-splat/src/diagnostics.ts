import { NitroModules } from 'react-native-nitro-modules';
import type { SplatDiagnostics } from './SplatDiagnostics.nitro';

export type { SplatDiagnosticsSnapshot } from './SplatDiagnostics.nitro';

const DEBUG_ONLY = 'Splat diagnostics require a Debug build';

/** Explicit spike tooling, separate from the production package entry point. */
export function getSplatDiagnostics(): SplatDiagnostics {
  if (!__DEV__) {
    throw new Error(DEBUG_ONLY);
  }
  return NitroModules.createHybridObject<SplatDiagnostics>('SplatDiagnostics');
}
