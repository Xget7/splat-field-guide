jest.mock('react-native-worklets', () => ({ createWorkletRuntime: jest.fn(({ name }) => ({ name })) }));
jest.mock('react-native-executorch', () => ({
  setTelemetryEnabled: jest.fn(), createKokoroTextToSpeech: jest.fn(),
  createWhisperSpeechToText: jest.fn(), createLLMChatSession: jest.fn(),
}));
jest.mock('../src/local/audio', () => ({ createAudio: jest.fn() }));
jest.mock('../src/local/files', () => ({ modelFiles: jest.fn() }));
const native = require('react-native-executorch');
const { createAudio } = require('../src/local/audio');
const { modelFiles } = require('../src/local/files');
const { createLocalRuntime } = require('../src/local/runtime');
const assets = require('../src/local/modelAssets.json');
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

beforeEach(() => jest.resetAllMocks());

function fixture(installed = true) {
  const content = new Map(installed ? assets.map(asset => [`/documents/miris-executorch-v1/${asset.id}`, asset]) : []);
  const files = {
    directory: '/documents', exists: async path => content.has(path),
    size: async path => content.get(path).bytes, hash: async path => content.get(path).sha256,
    mkdir: jest.fn(), remove: jest.fn(), move: jest.fn(), download: jest.fn(),
  };
  modelFiles.mockReturnValue(files);
  createAudio.mockReturnValue({
    permission: jest.fn(async () => true), stopInput: jest.fn(), stopOutput: jest.fn(),
    stop: jest.fn(async () => {}),
  });
  return { files, content, runtime: createLocalRuntime() };
}

test('runtime quiescence waits for late native construction and disposal while retaining verified files', async () => {
  const { files, content, runtime } = fixture();
  const old = { dispose: jest.fn(), streamStop: jest.fn(), transcribeStop: jest.fn() };
  const fresh = { dispose: jest.fn(), streamStop: jest.fn(), transcribeStop: jest.fn() };
  const loading = deferred();
  native.createWhisperSpeechToText.mockReturnValueOnce(loading.promise).mockResolvedValueOnce(fresh);
  await runtime.models.restore();
  expect(runtime.models.getSnapshot().state).toBe('ready');
  const preparing = runtime.input.prepare('en-US');
  const cancelled = expect(preparing).rejects.toThrow(/cancel|retir/i);
  await flush();
  let released = false;
  const release = runtime.models.release().then(() => { released = true; });
  await flush();
  expect(released).toBe(false);
  loading.resolve(old);
  await cancelled; await release;
  expect(old.dispose).toHaveBeenCalledTimes(1);
  expect(runtime.models.getSnapshot().state).toBe('ready');
  expect(content.size).toBe(assets.length);
  expect(files.remove).not.toHaveBeenCalled();
  expect(files.download).not.toHaveBeenCalled();
  await expect(runtime.input.prepare('en-US')).resolves.toBe('available');
  expect(native.createWhisperSpeechToText).toHaveBeenCalledTimes(2);
  expect(fresh.dispose).not.toHaveBeenCalled();
  await runtime.models.release();
  expect(fresh.dispose).toHaveBeenCalledTimes(1);
});

test('quiescence awaits speculative Qwen construction and its cancelled warm retirement', async () => {
  const { runtime } = fixture();
  const loading = deferred();
  const session = { dispose: jest.fn(), stop: jest.fn() };
  native.createLLMChatSession.mockReturnValue(loading.promise);
  await runtime.models.restore();
  runtime.model.prewarm('Supplied evidence');
  await flush();
  let finished = false;
  const retiring = runtime.models.release().then(() => { finished = true; });
  await flush(); expect(finished).toBe(false);
  loading.resolve(session);
  await retiring;
  expect(session.dispose).toHaveBeenCalledTimes(1);
  expect(finished).toBe(true);
  expect(runtime.models.getSnapshot().state).toBe('ready');
});

test('a scene reservation immediately blocks local engines, retains ready files and notifies capability changes', async () => {
  const { runtime, files } = fixture();
  await runtime.models.restore();
  const availability = [];
  runtime.models.subscribe(() => availability.push(runtime.model.availability()));
  expect(runtime.model.availability()).toBe('available');
  const reserving = runtime.models.reserveScene();
  expect(runtime.model.availability()).toBe('unavailable');
  const lease = await reserving;
  expect(runtime.models.getSnapshot().state).toBe('ready');
  await expect(runtime.input.prepare('en-US')).resolves.toBe('unavailable');
  await expect(runtime.output.prepare()).rejects.toThrow(/scene/i);
  runtime.model.prewarm('Evidence');
  await expect(runtime.model.respond('Evidence', 'Question', jest.fn())).rejects.toThrow(/scene/i);
  expect(native.createWhisperSpeechToText).not.toHaveBeenCalled();
  expect(native.createKokoroTextToSpeech).not.toHaveBeenCalled();
  expect(native.createLLMChatSession).not.toHaveBeenCalled();
  expect(files.download).not.toHaveBeenCalled();
  lease.release(); lease.release();
  expect(runtime.model.availability()).toBe('available');
  expect(availability).toEqual(['unavailable', 'available']);
});

test('overlapping scene leases cannot unblock local inference until their own final release', async () => {
  const { runtime } = fixture(); await runtime.models.restore();
  const firstPending = runtime.models.reserveScene();
  const secondPending = runtime.models.reserveScene();
  const first = await firstPending;
  first.release(); first.release();
  expect(runtime.model.availability()).toBe('unavailable');
  await expect(runtime.input.prepare('en-US')).resolves.toBe('unavailable');
  const second = await secondPending;
  expect(runtime.model.availability()).toBe('unavailable');
  second.release();
  expect(runtime.model.availability()).toBe('available');
});

test('scene admission invalidates queued old constructors and awaits late native retirement', async () => {
  const { runtime } = fixture(); await runtime.models.restore();
  const loading = deferred();
  const old = { dispose: jest.fn(), streamStop: jest.fn(), transcribeStop: jest.fn() };
  native.createWhisperSpeechToText.mockReturnValue(loading.promise);
  const oldInput = runtime.input.prepare('en-US');
  const inputStopped = expect(oldInput).rejects.toThrow(/cancel|retir|scene/i);
  await flush();
  const oldOutput = runtime.output.prepare();
  const outputStopped = expect(oldOutput).rejects.toThrow(/cancel|retir|scene/i);
  let admitted = false;
  const reserving = runtime.models.reserveScene().then(lease => { admitted = true; return lease; });
  expect(runtime.model.availability()).toBe('unavailable');
  await flush(); expect(admitted).toBe(false);
  loading.resolve(old);
  await inputStopped; await outputStopped;
  const lease = await reserving;
  expect(old.dispose).toHaveBeenCalledTimes(1);
  expect(native.createKokoroTextToSpeech).not.toHaveBeenCalled();
  lease.release();
  expect(runtime.model.availability()).toBe('available');
});

test('failed scene admission drops only its own token while a replacement reservation remains held', async () => {
  const { runtime } = fixture(); await runtime.models.restore();
  const old = {
    dispose: jest.fn().mockImplementationOnce(() => { throw new Error('native busy'); }),
    streamStop: jest.fn(), transcribeStop: jest.fn(),
  };
  native.createWhisperSpeechToText.mockResolvedValue(old);
  await runtime.input.prepare('en-US');
  const first = runtime.models.reserveScene();
  const replacement = runtime.models.reserveScene();
  await expect(first).rejects.toThrow(/retire/);
  const lease = await replacement;
  expect(runtime.model.availability()).toBe('unavailable');
  expect(old.dispose).toHaveBeenCalledTimes(2);
  lease.release();
  expect(runtime.model.availability()).toBe('available');
});

test('verified Answers can generate while Listening waits, without loading speech engines from downloads', async () => {
  const { runtime, files, content } = fixture(false);
  const waiting = deferred(); let listeningStarted = false;
  files.download.mockImplementation(async (url, path, _signal, progress) => {
    const asset = assets.find(item => item.url === url);
    if (asset.id === 'whisper') { listeningStarted = true; await waiting.promise; }
    content.set(path, asset); progress(asset.bytes);
  });
  files.move.mockImplementation(async (from, to) => { content.set(to, content.get(from)); content.delete(from); });
  files.remove.mockImplementation(async path => { content.delete(path); });
  const session = {
    dispose: jest.fn(), stop: jest.fn(),
    sendMessage: jest.fn(async () => ({ finishReason: 'stop', stats: [{ numTokens: 5 }], messages: [{ role: 'assistant', content: 'Supplied evidence.' }] })),
  };
  native.createLLMChatSession.mockResolvedValue(session);
  const preparation = runtime.models.prepare();
  while (!listeningStarted) await Promise.resolve();
  expect(runtime.models.getSnapshot().state).toBe('downloading');
  expect(runtime.models.getSnapshot().models[0].state).toBe('ready');
  expect(runtime.model.availability()).toBe('available');
  await expect(runtime.model.respond('Evidence', 'Question', jest.fn())).resolves.toBe('Supplied evidence.');
  expect(native.createLLMChatSession.mock.calls[0][0]).toEqual({
    modelPath: '/documents/miris-executorch-v1/llm',
    tokenizerPath: '/documents/miris-executorch-v1/tokenizer',
    tokenizerConfigPath: '/documents/miris-executorch-v1/tokenizerConfig',
  });
  expect(native.createWhisperSpeechToText).not.toHaveBeenCalled();
  expect(native.createKokoroTextToSpeech).not.toHaveBeenCalled();
  waiting.resolve(); await preparation;
});

test('a corrupt required Answers file cannot reach the native generation factory', async () => {
  const { runtime, content } = fixture();
  const llm = assets.find(asset => asset.id === 'llm');
  content.set('/documents/miris-executorch-v1/llm', { ...llm, sha256: 'corrupt' });
  await runtime.models.restore();
  expect(runtime.models.getSnapshot().models[0].state).toBe('missing');
  expect(runtime.model.availability()).toBe('modelsMissing');
  await expect(runtime.model.respond('Evidence', 'Question', jest.fn())).rejects.toThrow(/Prepare offline/);
  expect(native.createLLMChatSession).not.toHaveBeenCalled();
});
