import type { Pack } from '../../../pack/pack';
import type { LanguageModel } from '../../../../platform/ports';
import { promptFor, PromptNotes, rulesFor } from '../../domain/grounding';
import type { Answerer } from '../../domain/turn/answerer';
import { HistoryTurns } from '../../domain/turn/history';

const AVAILABLE = 'available';

/** Keep instructions stable for prewarming and caching; put question-specific evidence in the prompt. */
export function onDeviceInstructions(pack: Pack): string {
  return rulesFor(pack).join('\n');
}

export function createDeviceAnswerer(
  languageModel: () => LanguageModel,
): Answerer {
  return {
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
          history.slice(-HistoryTurns.device),
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
}
