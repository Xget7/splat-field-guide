import { speechInput } from 'react-native-on-device';
import { fixturePack } from '../../../testing/fixturePack';
import { INITIAL_SESSION } from '../../guide/session';
import { createPipelineVoiceSession } from './pipelineVoiceSession';
import {
  createAgentVoiceSession,
  type SessionAgentHandlers,
} from './agentVoiceSession';
import type { VoiceSessionEvents } from './voiceSession';

const pack = fixturePack();
const context = { pack, state: INITIAL_SESSION, history: [], thinking: false };
const events = (): VoiceSessionEvents => ({
  listening: jest.fn(),
  transcript: jest.fn(),
  speaking: jest.fn(),
  word: jest.fn(),
  level: jest.fn(),
  hint: jest.fn(),
  question: jest.fn(),
  cancelQuestion: jest.fn(),
  turn: jest.fn(),
  action: jest.fn(),
  ended: jest.fn(),
});

test.each(['pipeline', 'agent'])(
  '%s can stop twice and restart without accepting an old conversation',
  async kind => {
    const conversations: SessionAgentHandlers[] = [];
    const session =
      kind === 'pipeline'
        ? createPipelineVoiceSession({ voice: 'system', hints: [] })
        : createAgentVoiceSession({
            pack,
            client: handlers => {
              conversations.push(handlers);
              return {
                start: jest.fn(async () => {}),
                sendText: jest.fn(),
                sendContext: jest.fn(),
                setMuted: jest.fn(),
                interrupt: jest.fn(),
                stop: jest.fn(),
              };
            },
          });
    const first = events();
    await session.start(context, first);
    const previous =
      kind === 'pipeline'
        ? jest.mocked(speechInput().listen).mock.calls.at(-1)![3]
        : conversations[0].userTranscript;
    session.stop();
    session.stop();
    const next = events();
    await session.start(context, next);
    previous('Where is the battery?');
    expect(first.ended).not.toHaveBeenCalled();
    expect(next.question).not.toHaveBeenCalled();
    expect(next.turn).not.toHaveBeenCalled();
    const heard =
      kind === 'pipeline'
        ? jest.mocked(speechInput().listen).mock.calls.at(-1)![3]
        : conversations[1].userTranscript;
    heard('Where is the battery?');
    expect(
      kind === 'pipeline' ? next.question : next.turn,
    ).toHaveBeenCalledTimes(1);
    session.stop();
  },
);
