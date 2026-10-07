import { speechInput } from 'react-native-on-device';
import { fixturePack } from './fixturePack';
import { voiceEvents } from './voiceSession';
import { INITIAL_SESSION } from '../apps/field-guide/src/features/guide/session';
import { createPipelineVoiceSession } from '../apps/field-guide/src/features/instructor/voice/pipelineVoiceSession';
import {
  createAgentVoiceSession,
  type SessionAgentHandlers,
} from '../apps/field-guide/src/features/instructor/voice/agentVoiceSession';
import { SpeechVoice } from '../apps/field-guide/src/features/instructor/voice/voiceCopy';

const pack = fixturePack();
const context = { pack, state: INITIAL_SESSION, history: [], thinking: false };
const adapters = [
  {
    name: 'pipeline',
    create: () => ({
      session: createPipelineVoiceSession({
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
