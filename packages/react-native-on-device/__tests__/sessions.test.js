const { createLocalCapabilities } = require('../src/local/sessions');
const { createAudioLink, encodePCM, decodePCM } = require('../src/local/remoteAudio');
const flush = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); } };
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function stream() {
  let pending = deferred();
  return {
    push: value => { const previous = pending; pending = deferred(); previous.resolve({ value, done: false }); },
    end: () => pending.resolve({ done: true }),
    [Symbol.asyncIterator]() { return this; }, next() { return pending.promise; },
  };
}
function fixture() {
  const updates = stream();
  const audio = {
    permission: jest.fn(async () => true), record: jest.fn(async () => {}),
    play: jest.fn(async () => {}), stopInput: jest.fn(), stopOutput: jest.fn(),
    finishOutput: jest.fn(), stop: jest.fn(async () => {}), playedMs: jest.fn(() => 0),
  };
  const stt = { stream: jest.fn(() => updates), streamInsert: jest.fn(),
    streamStop: jest.fn(() => updates.end()), transcribeStop: jest.fn() };
  const tts = { synthesize: jest.fn(async function* () {
    yield { audio: new Float32Array(240), sampleRate: 24000, duration: 0.01, words: [{ text: 'Arm', offset: 0, start: 0, end: 0.01 }] };
  }), synthesizeStop: jest.fn() };
  const answer = { sendMessage: jest.fn(async (_prompt, onToken) => {
    onToken('Supplied '); onToken('facts.');
    return { finishReason: 'stop', stats: [{ numTokens: 5 }], messages: [{ role: 'assistant', content: 'Supplied facts.' }] };
  }), dispose: jest.fn(), stop: jest.fn() };
  const inference = { speech: jest.fn(async () => tts), recognition: jest.fn(async () => stt), answer: jest.fn(async () => answer) };
  const models = { restore: jest.fn(async () => {}), getSnapshot: () => ({ state: 'ready' }) };
  return { audio, stt, tts, inference, models, answer, updates, local: createLocalCapabilities(audio, inference, models) };
}
test('generates a fresh grounded answer and passes cumulative streaming text', async () => {
  const { local, inference, answer } = fixture(); const partial = jest.fn();
  await expect(local.model.respond('Use pack evidence only', 'Selected arm', partial)).resolves.toBe('Supplied facts.');
  expect(inference.answer).toHaveBeenCalledWith('Use pack evidence only');
  expect(partial.mock.calls).toEqual([['Supplied '], ['Supplied facts.']]);
  expect(answer.dispose).toHaveBeenCalledTimes(1);
});
test('cancellation rejects even when the backend resolves and suppresses late tokens', async () => {
  const { local, answer } = fixture(); const result = deferred(); const partial = jest.fn();
  let token;
  answer.sendMessage.mockImplementation((_prompt, onToken) => { token = onToken; return result.promise; });
  const pending = local.model.respond('rules', 'part', partial);
  const assertion = expect(pending).rejects.toThrow(/cancelled/);
  await flush(); local.model.cancel(); token('stale');
  result.resolve({ finishReason: 'stop', stats: [], messages: [{ role: 'assistant', content: 'stale' }] });
  await assertion; expect(partial).not.toHaveBeenCalled(); expect(answer.stop).toHaveBeenCalled();
});
test('rejects truncated and empty local answers instead of committing partial guidance', async () => {
  const { local, answer } = fixture();
  answer.sendMessage.mockResolvedValueOnce({ finishReason: 'stop', stats: [{ numTokens: 384 }], messages: [{ role: 'assistant', content: 'First disconnect the' }] });
  await expect(local.model.respond('rules', 'part', jest.fn())).rejects.toThrow(/budget/);
  answer.sendMessage.mockResolvedValueOnce({ finishReason: 'stop', stats: [], messages: [] });
  await expect(local.model.respond('rules', 'part', jest.fn())).rejects.toThrow(/malformed/);
});
test('does not synthesize or play a request cancelled during model loading', async () => {
  const { local, inference, tts, audio } = fixture(); const load = deferred();
  inference.speech.mockReturnValue(load.promise);
  const pending = local.output.speak('Arm', 'en-US', jest.fn());
  await flush(); local.output.stop(); load.resolve(tts); await pending;
  expect(tts.synthesize).not.toHaveBeenCalled(); expect(audio.play).not.toHaveBeenCalled();
});
test('stops both synthesis and buffered playback, suppressing stale word callbacks', async () => {
  const { local, tts, audio } = fixture(); const playback = deferred(); const word = jest.fn(); let callback;
  audio.play.mockImplementation((_owner, _pcm, _rate, _words, _offset, onWord) => { callback = onWord; return playback.promise; });
  const pending = local.output.speak('Arm', 'en-US', word); await flush();
  callback(0, 3); local.output.stop(); callback(0, 3); playback.resolve(); await pending;
  expect(word).toHaveBeenCalledTimes(1); expect(tts.synthesizeStop).toHaveBeenCalled(); expect(audio.stopOutput).toHaveBeenCalled();
});
test('decodes cumulative committed speech once and discards a cancellation flush', async () => {
  const { local, stt, updates } = fixture(); const turn = jest.fn(); const partial = jest.fn();
  // prepare's initial cancel has no running stream.
  stt.streamStop.mockImplementation(() => {});
  await local.input.prepare('en-US');
  await local.input.listen('en-US', partial, turn, jest.fn(), jest.fn(), jest.fn());
  updates.push({ committed: 'Next.', nonCommitted: '' }); await flush();
  updates.push({ committed: 'Next. Explain arm.', nonCommitted: '' }); await flush();
  expect(turn.mock.calls).toEqual([['Next.'], ['Explain arm.']]);
  local.input.cancel(); updates.push({ committed: 'Next. Explain arm. Stale.', nonCommitted: '' }); await flush();
  expect(turn).toHaveBeenCalledTimes(2); updates.end();
});
test('local preparation has no download side effect when models are missing', async () => {
  const { audio, inference } = fixture();
  const local = createLocalCapabilities(audio, inference, { restore: jest.fn(async () => {}), getSnapshot: () => ({ state: 'missing' }) });
  expect(local.model.availability()).toBe('modelsMissing');
  await expect(local.input.prepare('en-US')).resolves.toBe('unavailable');
  expect(inference.recognition).not.toHaveBeenCalled();
});
test('remote audio uses literal little-endian PCM16 and clips full-scale samples', () => {
  expect([...decodePCM(encodePCM(new Float32Array([-2, -0.5, 0.5, 2])))]).toEqual([-1, -0.5, 0.5, 32767 / 32768]);
  expect(() => decodePCM('AA==')).toThrow(/PCM16/);
});
test('online audio waits for local capture release before opening and drops stale input', async () => {
  const { audio } = fixture(); const stopped = deferred(); const incoming = jest.fn();
  audio.stop.mockReturnValue(stopped.promise);
  const link = createAudioLink(audio, jest.fn());
  const start = link.start(16000, 24000, incoming, jest.fn(), jest.fn());
  await flush(); expect(audio.record).not.toHaveBeenCalled();
  stopped.resolve(); await start;
  const callback = audio.record.mock.calls[0][1];
  callback(new Float32Array([0.5])); link.stop(); callback(new Float32Array([0.5]));
  expect(incoming).toHaveBeenCalledTimes(1);
});
test('cancelling online startup while capture is closing cannot reopen the microphone', async () => {
  const { audio } = fixture(); const stopped = deferred();
  audio.stop.mockReturnValue(stopped.promise);
  const link = createAudioLink(audio, jest.fn());
  const start = link.start(16000, 24000, jest.fn(), jest.fn(), jest.fn());
  await flush(); link.stop(); stopped.resolve(); await start;
  expect(audio.record).not.toHaveBeenCalled();
});
test('a stopped utterance also settles when its model load subsequently fails', async () => {
  const { local, inference } = fixture(); const load = deferred();
  inference.speech.mockReturnValue(load.promise);
  const pending = local.output.speak('Arm', 'en-US', jest.fn());
  await flush(); local.output.stop(); load.reject(new Error('loading stopped'));
  await expect(pending).resolves.toBeUndefined();
});
