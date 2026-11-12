import { INITIAL_SESSION } from '../../guide';
import { evidenceFor } from '../domain/context';
import { fixturePack } from '@tests/fixturePack';
import { createCloudAnswerer } from '../data/answerers/cloudAnswerer';
import { fakePlatform, fakeAgentTransport } from '@tests/platform';
import { createProxyClient } from '../data/proxy/proxyClient';
const pack = fixturePack();
const request = {
  question: 'Where is the battery?',
  evidence: evidenceFor('Where is the battery?', INITIAL_SESSION, pack),
  state: INITIAL_SESSION,
  pack,
  history: [],
};
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
function setup() {
  const transport = fakeAgentTransport();
  const fake = fakePlatform({
    socket: transport.connect,
    fetch: jest.fn(async () => ({
      status: 200,
      json: async () => ({ signedUrl: 'wss://fake' }),
    })) as unknown as typeof fetch,
  });
  const answerer = createCloudAnswerer({
    ...fake.platform,
    proxy: createProxyClient('https://issuer', fake.platform),
  });
  return { transport, fake, answerer };
}
test('typed answers use direct text-only sessions and exact tools without microphone access', async () => {
  const { transport, fake, answerer } = setup();
  const pending = answerer.respond(request, jest.fn());
  await jest.advanceTimersByTimeAsync(0);
  transport.ready();
  await jest.advanceTimersByTimeAsync(0);
  expect(transport.sent[0]).toMatchObject({
    conversation_config_override: { conversation: { text_only: true } },
  });
  expect(transport.sent).toContainEqual({
    type: 'user_message',
    text: request.question,
  });
  expect(fake.link.start).not.toHaveBeenCalled();
  transport.receive({
    type: 'client_tool_call',
    client_tool_call: {
      tool_name: 'get_part',
      tool_call_id: 'lookup',
      parameters: { part_id: 'battery' },
      event_id: 1,
    },
  });
  transport.receive({
    type: 'client_tool_call',
    client_tool_call: {
      tool_name: 'show_part',
      tool_call_id: 'show',
      parameters: { part_id: 'battery' },
      event_id: 2,
    },
  });
  transport.receive({
    type: 'agent_response',
    agent_response_event: {
      agent_response: 'Here is the battery.',
      event_id: 3,
    },
  });
  await expect(pending).resolves.toMatchObject({
    reply: 'Here is the battery.',
    event: { type: 'select', partId: 'battery' },
  });
  expect(transport.open).toBe(0);
});
test('cancelling a pending action closes its socket without committing the action', async () => {
  const { transport, answerer } = setup();
  const pending = answerer.respond(request, jest.fn());
  const rejected = pending.catch(error => error);
  await jest.advanceTimersByTimeAsync(0);
  transport.ready();
  await jest.advanceTimersByTimeAsync(0);
  transport.receive({
    type: 'client_tool_call',
    client_tool_call: {
      tool_name: 'show_part',
      tool_call_id: 'show',
      parameters: { part_id: 'battery' },
      event_id: 1,
    },
  });
  answerer.cancel();
  expect(await rejected).toBeInstanceOf(Error);
  expect(transport.open).toBe(0);
});
