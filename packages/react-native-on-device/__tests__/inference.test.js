jest.mock('react-native-worklets', () => ({ createWorkletRuntime: jest.fn(({ name }) => ({ name })) }));
jest.mock('react-native-executorch', () => ({
  setTelemetryEnabled: jest.fn(),
  createKokoroTextToSpeech: jest.fn(),
  createWhisperSpeechToText: jest.fn(),
  createLLMChatSession: jest.fn(),
}));

const native = require('react-native-executorch');
const { createInference } = require('../src/local/inference');
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const paths = () => ({ llm: '/llm', tokenizer: '/tokenizer', tokenizerConfig: '/tokenizerConfig' });

beforeEach(() => jest.resetAllMocks());

test('native construction is serial across real speech, recognition and answer factories', async () => {
  const speech = deferred(); const recognition = deferred(); const events = [];
  native.createKokoroTextToSpeech.mockImplementation(() => { events.push('speech:start'); return speech.promise; });
  native.createWhisperSpeechToText.mockImplementation(() => { events.push('recognition:start'); return recognition.promise; });
  const answer = { dispose: jest.fn() };
  native.createLLMChatSession.mockImplementation(async () => { events.push('answer:start'); return answer; });
  const inference = createInference(paths);
  const first = inference.speech(); const second = inference.recognition(); const third = inference.answer('Pack evidence');
  await flush();
  expect(events).toEqual(['speech:start']);
  speech.resolve({ dispose: jest.fn() }); await first; await flush();
  expect(events).toEqual(['speech:start', 'recognition:start']);
  recognition.resolve({ dispose: jest.fn() }); await second; await third;
  expect(events).toEqual(['speech:start', 'recognition:start', 'answer:start']);
  await inference.release();
  expect(answer.dispose).toHaveBeenCalledTimes(1);
});

test('release waits for an old constructor, disposes it and prevents a new owner reusing that runner', async () => {
  const loading = deferred(); const events = [];
  const stale = { dispose: jest.fn(() => events.push('old:dispose')) };
  const fresh = { dispose: jest.fn() };
  native.createKokoroTextToSpeech
    .mockImplementationOnce(() => loading.promise)
    .mockImplementationOnce(async () => { events.push('new:create'); return fresh; });
  const inference = createInference(paths);
  const old = inference.speech(); await flush();
  let finished = false;
  const releasing = inference.release().then(() => { finished = true; });
  const next = inference.speech();
  const oldResult = expect(old).rejects.toThrow(/cancel|retir/i);
  await flush();
  expect(finished).toBe(false);
  expect(native.createKokoroTextToSpeech).toHaveBeenCalledTimes(1);
  loading.resolve(stale);
  await oldResult; await releasing;
  expect(stale.dispose).toHaveBeenCalledTimes(1);
  expect(await next).toBe(fresh);
  expect(events).toEqual(['old:dispose', 'new:create']);
});

test('release does not dispose an executing answer before its caller is quiescent', async () => {
  const working = deferred(); const session = { dispose: jest.fn() };
  native.createLLMChatSession.mockResolvedValue(session);
  const inference = createInference(paths);
  await inference.answer('Evidence');
  let finished = false;
  const releasing = inference.release(working.promise).then(() => { finished = true; });
  await flush();
  expect(session.dispose).not.toHaveBeenCalled();
  expect(finished).toBe(false);
  // A caller's finally can queue its own disposal without deadlocking the release barrier.
  await inference.disposeAnswer(session);
  working.resolve(); await releasing;
  expect(session.dispose).toHaveBeenCalledTimes(1);
});

test('failed disposal blocks new constructors until explicit retirement succeeds', async () => {
  const old = { dispose: jest.fn().mockImplementationOnce(() => { throw new Error('native busy'); }) };
  const fresh = { dispose: jest.fn() };
  native.createKokoroTextToSpeech.mockResolvedValueOnce(old).mockResolvedValueOnce(fresh);
  const inference = createInference(paths);
  await inference.speech();
  await expect(inference.release()).rejects.toThrow(/retire/);
  await expect(inference.speech()).rejects.toThrow(/retire/);
  expect(native.createKokoroTextToSpeech).toHaveBeenCalledTimes(1);
  await inference.release();
  expect(await inference.speech()).toBe(fresh);
  expect(old.dispose).toHaveBeenCalledTimes(2);
});

test('a scene reservation rejects already-queued constructors before they can allocate', async () => {
  const loading = deferred();
  const speech = { dispose: jest.fn() };
  native.createKokoroTextToSpeech.mockReturnValue(loading.promise);
  native.createWhisperSpeechToText.mockResolvedValue({ dispose: jest.fn() });
  const inference = createInference(paths);
  const first = inference.speech();
  const firstStopped = expect(first).rejects.toThrow(/cancel|retir|scene/i);
  await flush();
  const queued = inference.recognition();
  const queuedStopped = expect(queued).rejects.toThrow(/cancel|retir|scene/i);
  await flush();
  const lease = inference.reserveScene();
  const retiring = inference.release();
  loading.resolve(speech);
  await firstStopped; await queuedStopped; await retiring;
  expect(speech.dispose).toHaveBeenCalledTimes(1);
  expect(native.createWhisperSpeechToText).not.toHaveBeenCalled();
  lease.release();
});
