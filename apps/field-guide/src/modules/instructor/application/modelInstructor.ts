import type { Pack } from '../../../domain/pack';
import { evidenceFor } from '../domain/context';
import { answerAbout, replyFrom } from '../domain/grounding';
import {
  answerFor,
  isQuestion,
  isScripted,
  type InstructorAnswer,
} from '../domain/instructor';
import type { InstructorModel, ModelRequest } from '../domain/InstructorModel';
import {
  ExchangePhase,
  TurnEventType,
  type Exchange,
  type TurnEvent,
} from '../domain/turn';

/** Owns one turn, including routing, fallback and the lifetime of its provisional presentation. */
export function createModelInstructor(models: readonly InstructorModel[]) {
  let request = 0;
  let active: { id: number; changed: (event: TurnEvent) => void } | null = null;
  const readyModels = () => models.filter(model => model.isReady());

  function prewarm(pack: Pack): void {
    readyModels().forEach(model => model.prewarm(pack));
  }

  function cancel(): void {
    const previous = active;
    active = null;
    models.forEach(model => model.cancel());
    previous?.changed({ type: TurnEventType.cancel });
  }

  async function ask(
    input: Omit<ModelRequest, 'evidence'>,
    changed: (event: TurnEvent) => void,
  ): Promise<void> {
    const question = input.question.trim();
    if (question === '') {
      return;
    }
    if (active !== null) {
      cancel();
    }
    const { state, pack, history } = input;
    const id = ++request;
    active = { id, changed };
    const exchange: Exchange = {
      id,
      question,
      reply: '',
      caution: '',
      part: null,
      phase: ExchangePhase.pending,
    };
    changed({ type: TurnEventType.begin, exchange });
    const current = () => active?.id === id;
    const finish = (answer: InstructorAnswer) => {
      if (!current()) {
        return;
      }
      active = null;
      changed({
        type: TurnEventType.answer,
        answer,
        exchange: {
          ...exchange,
          reply: answer.reply,
          caution: answer.caution,
          part: answer.part,
          phase: ExchangePhase.done,
        },
      });
    };
    if (isScripted(question, pack) || !isQuestion(question, pack)) {
      finish(answerFor(question, state, pack));
      return;
    }
    const evidence = evidenceFor(question, state, pack);
    const subject = evidence.subject;
    for (const model of readyModels()) {
      if (!current()) {
        return;
      }
      try {
        const text = await model.respond(
          { question, state, pack, history, evidence },
          partial => {
            const reply = replyFrom(partial, evidence, true);
            if (reply !== '' && current()) {
              changed({
                type: TurnEventType.partial,
                exchange: {
                  ...exchange,
                  reply,
                  part: answerAbout(reply, subject).part,
                  phase: ExchangePhase.streaming,
                },
              });
            }
          },
        );
        if (!current()) {
          return;
        }
        const reply = replyFrom(text, evidence);
        if (reply !== '') {
          finish(answerAbout(reply, subject));
          return;
        }
      } catch {
        // The next model, or the script, answers instead.
      }
      if (current()) {
        // A failed model's provisional words and highlight do not belong to its fallback.
        changed({ type: TurnEventType.partial, exchange });
      }
    }
    finish(answerFor(question, state, pack));
  }

  return { prewarm, ask, cancel };
}

export type ModelInstructor = ReturnType<typeof createModelInstructor>;
