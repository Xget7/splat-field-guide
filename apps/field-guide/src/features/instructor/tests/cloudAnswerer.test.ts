import { INITIAL_SESSION } from '../../guide';
import { evidenceFor } from '../domain/context';
import { fixturePack } from '@tests/fixturePack';
import {
  cloudInstructions,
  createCloudAnswerer,
} from '../data/answerers/cloudAnswerer';
import { fakePlatform, fakeTextStreams } from '@tests/platform';
import { createProxyClient } from '../data/proxy/proxyClient';
import { ProxyPath } from '../data/proxy/proxyContract';
import { ReplyTiming } from '../domain/turn/replyPolicy';

const requests = fakeTextStreams();
const { platform } = fakePlatform({ streamText: requests.streamText });
const pack = fixturePack();
const URL = 'https://proxy.example';
const request = {
  question: 'What does the battery do?',
  evidence: evidenceFor('What does the battery do?', INITIAL_SESSION, pack),
  state: INITIAL_SESSION,
  pack,
  history: [],
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('is ready only with a proxy, online and outside the cool-off after a failure', async () => {
  let online = false;
  const cloud = createCloudAnswerer({
    ...platform,
    proxy: createProxyClient(URL, platform),
    isOnline: () => online,
  });
  expect(createCloudAnswerer({ ...platform, proxy: null }).isReady()).toBe(
    false,
  );
  expect(cloud.isReady()).toBe(false);
  online = true;
  expect(cloud.isReady()).toBe(true);
  const reply = cloud.respond(request, jest.fn());
  requests.last.fail();
  await expect(reply).rejects.toThrow();
  expect(cloud.isReady()).toBe(false);
  jest.advanceTimersByTime(ReplyTiming.COOL_OFF_MS);
  expect(cloud.isReady()).toBe(true);
});

test('posts the instructions and a prompt without notes to the proxy', () => {
  createCloudAnswerer({
    ...platform,
    proxy: createProxyClient(URL, platform),
  }).respond(request, jest.fn());
  const sent = requests.last;
  expect(sent.url).toBe(`${URL}${ProxyPath.answer}`);
  expect(JSON.parse(sent.body)).toEqual({
    system: cloudInstructions(pack),
    prompt: 'Part: Battery\nQuestion: What does the battery do?',
  });
});
