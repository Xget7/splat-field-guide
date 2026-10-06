import { languageModel } from 'react-native-on-device';
import type { Pack } from '../../pack/pack';
import { promptFor, PromptNotes, rulesFor } from '../grounding';
import type { InstructorModel } from './InstructorModel';

const AVAILABLE = 'available';
// Limit history to leave room in the on-device model's 4096-token window.
const ON_DEVICE_HISTORY_TURNS = 1;

/** Keep instructions stable for prewarming and caching; put question-specific evidence in the prompt. */
export function onDeviceInstructions(pack: Pack): string {
  return rulesFor(pack).join('\n');
}

export const onDeviceModel: InstructorModel = {
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
      // Fall back when prewarming is unavailable.
    }
  },
  respond({ question, state, pack, history, evidence }, onText) {
    return languageModel().respond(
      onDeviceInstructions(pack),
      promptFor(
        question,
        state,
        pack,
        history.slice(-ON_DEVICE_HISTORY_TURNS),
        PromptNotes.subject,
        evidence,
      ),
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
