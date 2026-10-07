import { NitroModules, type HybridObject } from 'react-native-nitro-modules';
import type { AudioLink as AudioLinkSpec } from './AudioLink.nitro';
import type { NetworkMonitor as NetworkMonitorSpec } from './NetworkMonitor.nitro';
import type { LanguageModel as LanguageModelSpec } from './LanguageModel.nitro';
import type { SpeechInput as SpeechInputSpec } from './SpeechInput.nitro';
import type { SpeechOutput as SpeechOutputSpec } from './SpeechOutput.nitro';

export type {
  LanguageModel as LanguageModelSpec,
  LanguageModelAvailability,
} from './LanguageModel.nitro';
export type {
  SpeechInput as SpeechInputSpec,
  SpeechInputAvailability,
  SpeechPermission,
} from './SpeechInput.nitro';
export type {
  SpeechOutput as SpeechOutputSpec,
  SpeechVoice,
} from './SpeechOutput.nitro';
export type { AudioLink as AudioLinkSpec } from './AudioLink.nitro';
export type {
  NetworkMonitor as NetworkMonitorSpec,
  NetworkPath,
  NetworkTransport,
} from './NetworkMonitor.nitro';

// Created on first use, so importing this package never fails where the native side is absent.
function lazy<T extends HybridObject<{}>>(name: string): () => T {
  let instance: T | undefined;
  return () => (instance ??= NitroModules.createHybridObject<T>(name));
}

export const speechInput = lazy<SpeechInputSpec>('SpeechInput');
export const speechOutput = lazy<SpeechOutputSpec>('SpeechOutput');
export const languageModel = lazy<LanguageModelSpec>('LanguageModel');

export const audioLink = lazy<AudioLinkSpec>('AudioLink');
export const networkMonitor = lazy<NetworkMonitorSpec>('NetworkMonitor');
