import type { Pack } from '../../../pack/pack';
import {
  promptFor,
  PromptNotes,
  ReplyFormat,
  rulesFor,
} from '../../domain/grounding';
import { packKnowledge } from '../../domain/knowledge';
import type { Answerer } from '../../domain/turn/answerer';
import type { Clock, Timers } from '../../../../platform/ports';
import {
  createReplyPolicy,
  type ReplyFailure,
} from '../../domain/turn/replyPolicy';
import type { ProxyClient } from '../proxy/proxyClient';

export const CLOUD_HISTORY_TURNS = 4;

/** Cache the full pack instructions upstream so the model can reason across parts. */
export function cloudInstructions(pack: Pack): string {
  return [
    ...rulesFor(pack, ReplyFormat.structured),
    '',
    packKnowledge(pack),
  ].join('\n');
}

const NO_PROXY = 'Cloud answerer: no proxy';

export interface CloudAnswererOptions {
  readonly proxy: ProxyClient | null;
  readonly isOnline?: () => boolean;
  /** Each failed reply by kind; a cancelled one is not a failure. */
  readonly onFailure?: (failure: ReplyFailure) => void;
  readonly clock: Clock;
  readonly timers: Timers;
}

/** Answers with Claude through the Worker, waiting on a streamed reply only as the reply policy allows. */
export function createCloudAnswerer({
  proxy,
  clock,
  timers,
  isOnline = () => true,
  onFailure,
}: CloudAnswererOptions): Answerer {
  const policy = createReplyPolicy({ clock, timers, onFailure });
  return {
    isReady: () => proxy !== null && isOnline() && policy.ready(),
    prewarm() {
      // The first question sends the upstream cache hint; nothing to load here.
    },
    async respond({ question, state, pack, history, evidence }, onText) {
      if (proxy === null) {
        throw new Error(NO_PROXY);
      }
      const request = {
        system: cloudInstructions(pack),
        prompt: promptFor(
          question,
          state,
          pack,
          history.slice(-CLOUD_HISTORY_TURNS),
          PromptNotes.none,
          evidence,
        ),
      };
      return policy.run(report => proxy.answer(request, report), onText);
    },
    cancel() {
      policy.cancel();
    },
  };
}
