import { NitroModules, type HybridObject } from 'react-native-nitro-modules';
import type { LanguageModel as LanguageModelSpec } from './LanguageModel.nitro';
import type { SpeechInput as SpeechInputSpec } from './SpeechInput.nitro';
import type { SpeechOutput as SpeechOutputSpec } from './SpeechOutput.nitro';

export type {
  LanguageModel as LanguageModelSpec,
  LanguageModelAvailability,
  ResponseField,
} from './LanguageModel.nitro';
export type {
  SpeechInput as SpeechInputSpec,
  SpeechInputAvailability,
  SpeechPermission,
} from './SpeechInput.nitro';
export type { SpeechOutput as SpeechOutputSpec } from './SpeechOutput.nitro';

// Created on first use, so importing this package never fails where the native side is absent.
function lazy<T extends HybridObject<{}>>(name: string): () => T {
  let instance: T | undefined;
  return () => (instance ??= NitroModules.createHybridObject<T>(name));
}

export const speechInput = lazy<SpeechInputSpec>('SpeechInput');
export const speechOutput = lazy<SpeechOutputSpec>('SpeechOutput');
export const languageModel = lazy<LanguageModelSpec>('LanguageModel');
