import { SessionEventType, type SessionEvent } from '../../../guide';
import type { Answerer } from '../../domain/turn/answerer';
import type { Clock, Socket, Timers } from '../../../../platform/ports';
import {
  createReplyPolicy,
  type ReplyFailure,
} from '../../domain/turn/replyPolicy';
import {
  agentVariables,
  COURSE_CHAT_CONTEXT,
  historyUpdate,
} from '../../domain/agent/agentVariables';
import {
  runAgentTool,
  toolResult,
  type KnowledgeLoader,
  type ToolKnowledge,
} from '../../domain/agent/agentTools';
import { createAgentClient } from '../agent/agentClient';
import type { ProxyClient } from '../proxy/proxyClient';

export interface CloudAnswererOptions {
  readonly proxy: ProxyClient | null;
  readonly knowledge?: KnowledgeLoader;
  readonly socket: (url: string) => Socket;
  readonly isOnline?: () => boolean;
  readonly onFailure?: (failure: ReplyFailure) => void;
  readonly clock: Clock;
  readonly timers: Timers;
}

/** Text-only ElevenLabs sessions use the same validated tools as voice, without microphone access. */
export function createCloudAnswerer({
  proxy,
  knowledge,
  socket,
  clock,
  timers,
  isOnline = () => true,
  onFailure,
}: CloudAnswererOptions): Answerer {
  const policy = createReplyPolicy({ clock, timers, onFailure });
  return {
    courseKnowledge: true,
    isReady: () => proxy !== null && isOnline() && policy.ready(),
    prewarm() {},
    async respond(request, onText) {
      if (!proxy) throw new Error('ElevenLabs session issuer is unavailable');
      let event: SessionEvent | null = null;
      let state = request.state;
      let prepared: ToolKnowledge = {};
      const reply = await policy.run(report => {
        let settled = false;
        let resolve!: (text: string) => void;
        let reject!: (error: Error) => void;
        const text = new Promise<string>((done, failed) => {
          resolve = done;
          reject = failed;
        });
        const finish = (value?: string) => {
          if (settled) return;
          settled = true;
          client.stop();
          if (value?.trim()) resolve(value);
          else reject(new Error('ElevenLabs reply did not complete'));
        };
        const client = createAgentClient({
          signedUrl: proxy.sessionUrl,
          connect: socket,
          timers,
          textOnly: true,
          handlers: {
            status() {},
            userTranscript() {},
            responseText: report,
            response: value => finish(value),
            correction() {},
            interruption() {},
            speaking() {},
            word() {},
            level() {},
            roundTrip() {},
            ended: () => finish(),
            toolCall(name, parameters) {
              if (settled)
                return {
                  result: 'The turn is no longer active.',
                  isError: true,
                };
              const outcome = runAgentTool(
                name,
                parameters,
                state,
                request.pack,
                request.question,
                prepared,
              );
              if (outcome.ok && outcome.event) {
                const previous = event as SessionEvent | null;
                const selecting =
                  outcome.event.type === SessionEventType.select &&
                  outcome.event.partId !== null;
                const previousParts =
                  previous?.type === SessionEventType.select
                    ? [previous.partId!]
                    : previous?.type === SessionEventType.selectParts
                    ? previous.partIds
                    : [];
                if (previous && !(selecting && previousParts.length))
                  return {
                    result:
                      'Only component selections can be combined in one reply. Ask the operator before changing procedure navigation again.',
                    isError: true,
                  };
                state = outcome.state;
                const ids = selecting
                  ? [
                      ...new Set([
                        ...previousParts,
                        outcome.event.partId as string,
                      ]),
                    ]
                  : [];
                event =
                  ids.length > 1
                    ? { type: SessionEventType.selectParts, partIds: ids }
                    : outcome.event;
              }
              return {
                result: toolResult(outcome, request.navigation === 'proposal'),
                isError: !outcome.ok,
              };
            },
          },
        });
        const variables = {
          ...agentVariables(
            request.state,
            request.pack,
            request.history.length > 0,
          ),
          opening: '',
        };
        Promise.resolve(knowledge?.(request.pack) ?? {})
          .then(value => {
            prepared = value;
            if (settled) return;
            return client.start(variables, [
              ...(request.navigation === 'proposal'
                ? [COURSE_CHAT_CONTEXT]
                : []),
              ...(request.history.length
                ? [historyUpdate(request.history)]
                : []),
            ]);
          })
          .then(() => {
            if (!settled) client.sendText(request.question);
          })
          .catch(() => finish());
        return { text, cancel: () => finish() };
      }, onText);
      // Tool actions remain provisional until the complete response is accepted by the runner.
      const action = event as SessionEvent | null;
      return {
        reply,
        caution: '',
        event: action,
        part: action?.type === 'select' ? action.partId : null,
      };
    },
    cancel: () => policy.cancel(),
  };
}
