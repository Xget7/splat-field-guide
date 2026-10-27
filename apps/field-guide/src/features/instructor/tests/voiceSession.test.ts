import { fakePlatform } from '@tests/platform';
import { fixturePack } from '@tests/fixturePack';
import { voiceEvents } from '@tests/voiceSession';
import { INITIAL_SESSION } from '../../guide';
import { createPipelineVoiceSession } from '../data/voice/pipelineVoiceSession';
import {
  createAgentVoiceSession,
  type SessionAgentHandlers,
} from '../data/voice/agentVoiceSession';
import { SpeechVoice } from '../domain/voice/voiceCopy';

const { speechInput, speechOutput, audioLink, timers } =
  fakePlatform().platform;
const ports = { input: speechInput, output: speechOutput, timers };

const pack = fixturePack();
const context = { pack, state: INITIAL_SESSION, history: [], thinking: false };
const adapters = [
  {
    name: 'pipeline',
    create: () => ({
      session: createPipelineVoiceSession({
        ...ports,
        voice: SpeechVoice.system,
        hints: [],
      }),
      transcript: () => jest.mocked(speechInput().listen).mock.calls.at(-1)![3],
      question: (events: ReturnType<typeof voiceEvents>) => events.question,
    }),
  },
  {
    name: 'agent',
    create: () => {
      let conversation!: SessionAgentHandlers;
      return {
        session: createAgentVoiceSession({
          pack,
          audio: audioLink,
          client: handlers => {
            conversation = handlers;
            return {
              start: jest.fn(async () => {}),
              sendText: jest.fn(),
              sendContext: jest.fn(),
              setMuted: jest.fn(),
              interrupt: jest.fn(),
              stop: jest.fn(),
            };
          },
        }),
        transcript: () => conversation.userTranscript,
        question: (events: ReturnType<typeof voiceEvents>) => events.turn,
      };
    },
  },
];

test.each(adapters)(
  '$name can stop twice and restart without accepting an old conversation',
  async ({ create }) => {
    const adapter = create();
    const first = voiceEvents();
    await adapter.session.start(context, first);
    const previous = adapter.transcript();
    adapter.session.stop();
    adapter.session.stop();
    const next = voiceEvents();
    await adapter.session.start(context, next);
    previous('Where is the battery?');
    expect(first.ended).not.toHaveBeenCalled();
    expect(next.question).not.toHaveBeenCalled();
    expect(next.turn).not.toHaveBeenCalled();
    adapter.transcript()('Where is the battery?');
    expect(adapter.question(next)).toHaveBeenCalledWith(expect.anything());
    adapter.session.stop();
  },
);
