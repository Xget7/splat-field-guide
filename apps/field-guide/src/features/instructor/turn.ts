import type { Pack, PartId } from '../pack/pack';
import { reduce, SessionEventType, type SessionState } from '../guide/session';
import type { InstructorAnswer } from './instructor';

export const ExchangePhase = {
  pending: 'pending',
  streaming: 'streaming',
  done: 'done',
} as const;
export type ExchangePhase = (typeof ExchangePhase)[keyof typeof ExchangePhase];

export interface Exchange {
  readonly question: string;
  readonly reply: string;
  readonly caution: string;
  readonly id: number;
  readonly phase: ExchangePhase;
  readonly part: PartId | null;
}

export const TurnEventType = {
  begin: 'begin',
  partial: 'partial',
  answer: 'answer',
  cancel: 'cancel',
} as const;

export type TurnEvent =
  | {
      readonly type: typeof TurnEventType.begin | typeof TurnEventType.partial;
      readonly exchange: Exchange;
    }
  | {
      readonly type: typeof TurnEventType.answer;
      readonly exchange: Exchange;
      readonly answer: InstructorAnswer;
    }
  | { readonly type: typeof TurnEventType.cancel };

/** Streaming changes what is shown, never the committed session used by the next question. */
export function sessionForExchange(
  session: SessionState,
  exchange: Exchange | null,
  pack: Pack,
): SessionState {
  return exchange?.phase === ExchangePhase.streaming && exchange.part !== null
    ? reduce(
        session,
        { type: SessionEventType.select, partId: exchange.part },
        pack,
      )
    : session;
}
