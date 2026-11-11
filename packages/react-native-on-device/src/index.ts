import { NitroModules, type HybridObject } from 'react-native-nitro-modules';
import type { NetworkMonitor as NetworkMonitorSpec } from './NetworkMonitor.nitro';
import type { createLocalRuntime } from './local/runtime';
export type {
  LanguageModel as LanguageModelSpec,
  LanguageModelAvailability,
  SpeechInput as SpeechInputSpec,
  SpeechInputAvailability,
  SpeechPermission,
  SpeechOutput as SpeechOutputSpec,
  OfflineModels,
  OfflineModelStatus,
} from './capabilities';
export type { AudioLink as AudioLinkSpec } from './AudioLink';
export type {
  NetworkMonitor as NetworkMonitorSpec,
  NetworkPath,
  NetworkTransport,
} from './NetworkMonitor.nitro';

function lazy<T extends HybridObject<{}>>(name: string): () => T {
  let instance: T | undefined;
  return () => (instance ??= NitroModules.createHybridObject<T>(name));
}
let runtime: ReturnType<typeof createLocalRuntime> | undefined;
function local() {
  // Native inference and audio bindings are not touched until a capability is requested.
  runtime ??= (
    require('./local/runtime') as {
      createLocalRuntime: typeof createLocalRuntime;
    }
  ).createLocalRuntime();
  return runtime;
}
export const speechInput = () => local().input;
export const speechOutput = () => local().output;
export const languageModel = () => local().model;
export const audioLink = () => local().audioLink;
export const offlineModels = () => local().models;
export const networkMonitor = lazy<NetworkMonitorSpec>('NetworkMonitor');
