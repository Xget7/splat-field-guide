import type { Pack } from '../../../pack/pack';
import { evidenceFor } from '../context';
import { answerAbout, replyFrom } from '../grounding';
import {
  answerFor,
  isQuestion,
  isScripted,
  type InstructorAnswer,
} from '../instructor';
import type { Answerer, AnswerRequest } from './answerer';
import {
  ExchangePhase,
  type ExchangeIds,
  TurnEventType,
  type Exchange,
  type TurnEvent,
} from './exchange';

/**
 * Owns one turn, including routing, fallback and the lifetime of its provisional presentation.
 * Answerers are tried in order, then the script answers; ids come from the thread's one source.
 */
export function createTurnRunner(
  answerers: readonly Answerer[],
  ids: ExchangeIds,
) {
  let active: { id: number; changed: (event: TurnEvent) => void } | null = null;
  const readyAnswerers = () => answerers.filter(answerer => answerer.isReady());

  function prewarm(pack: Pack): void {
    readyAnswerers().forEach(answerer => answerer.prewarm(pack));
  }

  function cancel(): void {
    const previous = active;
    active = null;
    answerers.forEach(answerer => answerer.cancel());
    previous?.changed({ type: TurnEventType.cancel });
  }

  async function ask(
    input: Omit<AnswerRequest, 'evidence'>,
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
    const id = ids.next();
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
          readsStep: answer.readsStep,
        },
      });
    };
    if (isScripted(question, pack) || !isQuestion(question, pack)) {
      finish(answerFor(question, state, pack));
      return;
    }
    const evidence = evidenceFor(question, state, pack);
    const subject = evidence.subject;
    for (const answerer of readyAnswerers()) {
      if (!current()) {
        return;
      }
      let responding = true;
      try {
        const text = await answerer.respond(
          { question, state, pack, history, evidence },
          partial => {
            const reply = replyFrom(partial, evidence, true);
            if (reply !== '' && responding && current()) {
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
        // The next answerer, or the script, answers instead.
      } finally {
        responding = false;
      }
      if (current()) {
        // A failed answerer's provisional words and highlight do not belong to its fallback.
        changed({ type: TurnEventType.partial, exchange });
      }
    }
    finish(answerFor(question, state, pack));
  }

  return { prewarm, ask, cancel };
}

export type TurnRunner = ReturnType<typeof createTurnRunner>;
