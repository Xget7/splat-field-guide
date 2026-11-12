import type { Pack } from '../../../pack/pack';
import { evidenceFor } from '../context';
import { partClarification } from '../partReference';
import { relationshipAnswer } from '../knowledge';
import { answerAbout, replyFrom } from '../grounding';
import {
  answerFor,
  isQuestion,
  isScripted,
  NOT_COVERED_REPLY,
  type InstructorAnswer,
} from '../instructor';
import type { Answerer, AnswerRequest } from './answerer';
import type { KnowledgeLoader, ToolKnowledge } from '../agent/agentTools';
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
  knowledge?: KnowledgeLoader,
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
    const clarification = /\b(manual|pdf|section|document)\b/i.test(question)
      ? null
      : partClarification(question, pack);
    if (clarification) {
      finish(clarification);
      return;
    }
    if (
      !readyAnswerers().some(answerer => answerer.courseKnowledge) &&
      (isScripted(question, pack) || !isQuestion(question, pack))
    ) {
      const scripted = answerFor(question, state, pack);
      if (!knowledge || scripted.reply !== NOT_COVERED_REPLY) {
        finish(scripted);
        return;
      }
    }
    let prepared: ToolKnowledge = {};
    try {
      prepared = knowledge ? await knowledge(pack) : {};
    } catch {
      /* Unavailable files never become model evidence. */
    }
    if (!current()) return;
    const evidence = evidenceFor(
      question,
      state,
      pack,
      prepared.manuals?.search(question, undefined, 2),
    );
    if (
      !readyAnswerers().some(answerer => answerer.courseKnowledge) &&
      (isScripted(question, pack) || !isQuestion(question, pack)) &&
      !(
        evidence.manual.length > 0 &&
        answerFor(question, state, pack).reply === NOT_COVERED_REPLY
      )
    ) {
      finish(answerFor(question, state, pack));
      return;
    }
    const graphAnswer = relationshipAnswer(
      question,
      evidence.subject,
      evidence.relations,
    );
    if (graphAnswer) {
      finish(graphAnswer);
      return;
    }
    if (
      /\b(similar|resembles|looks like)\b/i.test(question) &&
      evidence.subject &&
      prepared.vectors
    ) {
      const ranked = prepared.vectors.similarParts(
        evidence.subject.id,
        /\b(visual|image|looks)\b/i.test(question) ? 'image' : 'text',
        3,
      );
      if (ranked.ok && ranked.matches.length) {
        finish({
          reply: `Similar prepared component records: ${ranked.matches
            .map(
              match =>
                pack.parts.find(part => part.id === match.partId)?.name ??
                match.partId,
            )
            .join(
              ', ',
            )}. Similarity does not establish a physical relationship.`,
          caution: '',
          part: null,
          event: null,
        });
        return;
      }
    }
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
            const reply = answerer.courseKnowledge
              ? partial
              : replyFrom(partial, evidence, true);
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
        if (typeof text !== 'string') {
          if (text.reply.trim()) {
            finish(text);
            return;
          }
          continue;
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
    const source = evidence.manual[0];
    finish(
      source
        ? {
            reply: `${source.text} Source: ${source.edition}, PDF page ${source.pdfPage}.`,
            caution: '',
            part: null,
            event: null,
          }
        : answerFor(question, state, pack),
    );
  }

  return { prewarm, ask, cancel };
}

export type TurnRunner = ReturnType<typeof createTurnRunner>;
