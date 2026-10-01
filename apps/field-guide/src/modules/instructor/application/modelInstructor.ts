import type { Pack, PartId } from '../../../domain/pack';
import type { SessionState } from '../../../domain/session';
import { subjectOf } from '../domain/context';
import {
  answerAbout,
  replyFrom,
  type PreviousExchange,
} from '../domain/grounding';
import {
  answerFor,
  isScripted,
  type InstructorAnswer,
} from '../domain/instructor';
import type { InstructorModel } from '../domain/InstructorModel';

export interface PartialAnswer {
  readonly reply: string;
  readonly part: PartId | null;
}

/** Model order is supplied by the composition; each instructor owns its request lifecycle. */
export function createModelInstructor(models: readonly InstructorModel[]) {
  // Each question or cancel starts a new request; an older one stops trying models.
  let request = 0;

  const readyModels = () => models.filter(model => model.isReady());

  /** Scripted questions, and questions no model can take now, keep the synchronous path. */
  function usesModel(question: string, pack: Pack): boolean {
    return !isScripted(question, pack) && readyModels().length > 0;
  }

  function prewarmInstructor(pack: Pack): void {
    readyModels().forEach(model => model.prewarm(pack));
  }

  function cancelInstructor(): void {
    request += 1;
    models.forEach(model => model.cancel());
  }

  /**
   * Asks each ready model in turn until one replies, then the script. The part is chosen
   * before any model runs, from the question and the screen, so it is highlighted as soon
   * as the first words stream in; the models only write the reply.
   */
  async function modelAnswer(
    question: string,
    state: SessionState,
    pack: Pack,
    previous: PreviousExchange | null,
    onPartial: (answer: PartialAnswer) => void,
  ): Promise<InstructorAnswer> {
    const id = ++request;
    const subject = subjectOf(question, state, pack);
    for (const model of readyModels()) {
      if (id !== request) {
        break;
      }
      try {
        const text = await model.respond(
          { question, state, pack, previous },
          partial => {
            const reply = replyFrom(partial, pack);
            if (reply !== '' && id === request) {
              onPartial({ reply, part: answerAbout(reply, subject).part });
            }
          },
        );
        const reply = replyFrom(text, pack);
        if (reply !== '') {
          return answerAbout(reply, subject);
        }
      } catch {
        // The next model, or the script, answers instead.
      }
    }
    return answerFor(question, state, pack);
  }

  return { usesModel, prewarmInstructor, cancelInstructor, modelAnswer };
}

export type ModelInstructor = ReturnType<typeof createModelInstructor>;
