const mockContexts = [];
const mockRecorders = [];
const mockManager = {
  setSystemOptions: jest.fn(), setAudioSessionActivity: jest.fn(async () => {}), observeAudioInterruptions: jest.fn(),
  addSystemEventListener: jest.fn(() => ({ remove: jest.fn() })), requestRecordingPermissions: jest.fn(async () => 'Granted'),
};
jest.mock('react-native', () => ({ Platform: { OS: 'ios', Version: '26' } }));
jest.mock('react-native-audio-api', () => ({
  AudioManager: mockManager,
  AudioContext: class {
    currentTime = 0; destination = {};
    resume = jest.fn(async () => {}); close = jest.fn(async () => {});
    createBuffer = jest.fn(() => ({ copyToChannel: jest.fn() }));
    createBufferSource = jest.fn(() => {
      const source = { connect: jest.fn(), disconnect: jest.fn(), stop: jest.fn(), start: jest.fn(), onended: null };
      this.sources.push(source); return source;
    });
    sources = [];
    constructor() { mockContexts.push(this); }
  },
  AudioRecorder: class {
    onAudioReady = jest.fn(() => ({ status: 'success' })); onError = jest.fn();
    clearOnAudioReady = jest.fn(); clearOnError = jest.fn();
    start = jest.fn(async () => ({ status: 'success' })); stop = jest.fn(async () => ({ status: 'success' }));
    constructor() { mockRecorders.push(this); }
  },
}));
const { createAudio } = require('../src/local/audio');
const flush = async () => { for (let i = 0; i < 15; i++) { await Promise.resolve(); } };
beforeEach(() => { mockContexts.length = 0; mockRecorders.length = 0; jest.clearAllMocks(); });
test('plays output without opening the microphone, then releases its session', async () => {
  const audio = createAudio(); const played = audio.play('local', new Float32Array(24), 24000);
  await flush(); expect(mockRecorders).toHaveLength(0);
  mockContexts[0].sources[0].onended(); await played;
  audio.finishOutput(); await audio.stop();
  expect(mockContexts[0].close).toHaveBeenCalledTimes(1);
});
test('stop waits for an in-flight audio opening and closes it before a new owner starts', async () => {
  let activate;
  mockManager.setAudioSessionActivity.mockImplementationOnce(() => new Promise(resolve => { activate = resolve; }));
  const audio = createAudio(); const played = audio.play('local', new Float32Array(24), 24000);
  await flush(); const stopped = audio.stop(); let finished = false; stopped.then(() => { finished = true; });
  await flush(); expect(finished).toBe(false);
  activate(); await played; await stopped;
  expect(mockContexts[0].close).toHaveBeenCalledTimes(1);
});
test('a source start failure releases its timer and output session', async () => {
  jest.useFakeTimers();
  const audio = createAudio();
  const first = audio.play('local', new Float32Array(24), 24000);
  await flush(); mockContexts[0].sources[0].onended(); await first;
  mockContexts[0].createBufferSource.mockImplementationOnce(() => ({ connect() {}, disconnect() {}, stop() {}, start() { throw new Error('route failed'); } }));
  await expect(audio.play('local', new Float32Array(24), 24000)).rejects.toThrow('route failed');
  audio.finishOutput(); await audio.stop();
  expect(jest.getTimerCount()).toBe(0); jest.useRealTimers();
});
test('route interruption rejects output even when no microphone is open', async () => {
  const audio = createAudio();
  const played = audio.play('local', new Float32Array(24), 24000);
  const failure = expect(played).rejects.toThrow(/interrupted/);
  await flush();
  const interrupt = mockManager.addSystemEventListener.mock.calls.find(call => call[0] === 'interruption')[1];
  interrupt({ type: 'began' }); await failure; await audio.stop();
  expect(mockContexts[0].close).toHaveBeenCalledTimes(1);
});
test('a stale local cancellation cannot release an online microphone', async () => {
  const audio = createAudio();
  await audio.record('remote', jest.fn(), jest.fn(), jest.fn());
  audio.stopInput('local'); audio.stopOutput('local'); await flush();
  expect(mockRecorders[0].stop).not.toHaveBeenCalled();
  await audio.stop('remote'); expect(mockRecorders[0].stop).toHaveBeenCalledTimes(1);
});
