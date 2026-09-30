import { NitroModules, getHostComponent } from 'react-native-nitro-modules';
import SplatViewConfig from '../nitrogen/generated/shared/json/SplatViewConfig.json';
import type {
  SplatDiagnostics as SplatDiagnosticsSpec,
} from './SplatDiagnostics.nitro';
import type { SplatViewMethods, SplatViewProps } from './SplatView.nitro';

export type {
  SplatDiagnostics as SplatDiagnosticsSpec,
  SplatDiagnosticsSnapshot,
} from './SplatDiagnostics.nitro';
export type {
  PartLabel,
  SplatView as SplatViewSpec,
  SplatViewMethods,
  SplatViewProps,
} from './SplatView.nitro';

export const SplatView = getHostComponent<SplatViewProps, SplatViewMethods>(
  'SplatView',
  () => SplatViewConfig,
);

export const SplatDiagnostics =
  NitroModules.createHybridObject<SplatDiagnosticsSpec>('SplatDiagnostics');
