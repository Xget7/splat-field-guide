import { languageModel } from 'react-native-on-device';
import type { Pack } from '../../../domain/pack';
import {
  Grounding,
  promptFor,
  PromptNotes,
  rulesFor,
} from '../domain/grounding';
import { ModelName, type InstructorModel } from '../domain/InstructorModel';

const AVAILABLE = 'available';

/**
 * The same text for every question of a pack, so a prewarmed session and its cache stay
 * valid; everything that varies goes in the prompt with only the notes it needs, since
 * Apple's on-device model holds 4096 tokens.
 */
export function onDeviceInstructions(pack: Pack): string {
  return rulesFor(pack, Grounding.strict).join('\n');
}

/** Apple Foundation Models: offline, private, and small enough to need the notes picked for it. */
export const onDeviceModel: InstructorModel = {
  name: ModelName.onDevice,
  isReady() {
    try {
      return languageModel().availability() === AVAILABLE;
    } catch {
      return false;
    }
  },
  prewarm(pack) {
    try {
      const model = languageModel();
      if (model.availability() === AVAILABLE) {
        model.prewarm(onDeviceInstructions(pack));
      }
    } catch {
      // Another model or the script answers without it.
    }
  },
  respond({ question, state, pack, previous }, onText) {
    return languageModel().respond(
      onDeviceInstructions(pack),
      promptFor(question, state, pack, previous, PromptNotes.subject),
      onText,
    );
  },
  cancel() {
    try {
      languageModel().cancel();
    } catch {
      // Cancellation also works when the native module is absent.
    }
  },
};
