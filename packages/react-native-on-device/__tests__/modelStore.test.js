const { createModelStore } = require('../src/local/modelStore');
const assets = require('../src/local/modelAssets.json');
function fixture() {
  const contents = new Map();
  const files = {
    directory: '/documents', exists: async path => contents.has(path),
    size: async path => contents.get(path).bytes, hash: async path => contents.get(path).sha256,
    mkdir: jest.fn(async () => {}), remove: async path => { contents.delete(path); },
    move: async (from, to) => { contents.set(to, contents.get(from)); contents.delete(from); },
    download: jest.fn(async (url, path, _signal, progress) => {
      const asset = assets.find(item => item.url === url);
      contents.set(path, asset); progress(asset.bytes);
    }),
  };
  return { files, contents, store: createModelStore(files, jest.fn()) };
}
test('restores without a network call and prepares all verified files only on request', async () => {
  const { store, files } = fixture();
  await store.restore();
  expect(store.getSnapshot().state).toBe('missing');
  expect(files.download).not.toHaveBeenCalled();
  expect(() => store.paths()).toThrow(/Prepare offline/);
  await store.prepare();
  expect(store.getSnapshot()).toMatchObject({ state: 'ready', progress: 1 });
  expect(Object.keys(store.paths())).toHaveLength(assets.length);
  const restarted = createModelStore(files, jest.fn());
  files.download.mockClear();
  await restarted.restore();
  expect(restarted.getSnapshot().state).toBe('ready');
  expect(files.download).not.toHaveBeenCalled();
});
test('rejects damaged bytes, removes staging, and reuses completed files on retry', async () => {
  const { store, files, contents } = fixture();
  const download = files.download.getMockImplementation();
  files.download.mockImplementationOnce(download).mockImplementationOnce(async (_url, path) => {
    contents.set(path, { bytes: assets[1].bytes, sha256: 'wrong' });
  });
  await expect(store.prepare()).rejects.toThrow(/verification/);
  expect(store.getSnapshot().state).toBe('error');
  expect([...contents.keys()].some(path => path.endsWith('.partial'))).toBe(false);
  expect(() => store.paths()).toThrow();
  files.download.mockClear();
  await store.prepare();
  expect(files.download).toHaveBeenCalledTimes(assets.length - 1);
  expect(store.getSnapshot().state).toBe('ready');
});
test('cancels a download without activating its files and can retry', async () => {
  const { store, files } = fixture();
  files.download.mockImplementationOnce((_url, _path, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const preparation = store.prepare();
  while (files.download.mock.calls.length === 0) { await Promise.resolve(); }
  store.cancel(); await preparation;
  expect(store.getSnapshot().state).toBe('missing');
  expect(() => store.paths()).toThrow();
  await store.prepare();
  expect(store.getSnapshot().state).toBe('ready');
});
test('checks digests even when a corrupt file has the expected size', async () => {
  const { store, files, contents } = fixture();
  await store.prepare();
  contents.set(store.paths().voice, { bytes: assets.find(asset => asset.id === 'voice').bytes, sha256: 'corrupt' });
  const restarted = createModelStore(files, jest.fn());
  await restarted.restore();
  expect(restarted.getSnapshot().state).toBe('missing');
});
test('pins every model file to a source commit, size and SHA-256', () => {
  for (const asset of assets) {
    expect(asset.url).toMatch(/^https:\/\/huggingface.co\/.+\/resolve\/[0-9a-f]{40}\//);
    expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(asset.bytes).toBeGreaterThan(0);
  }
});

test('prepare requested by a missing-state subscriber waits for restore and downloads once', async () => {
  const { store, files } = fixture();
  let preparation;
  const unsubscribe = store.subscribe(() => {
    if (store.getSnapshot().state === 'missing') { preparation = store.prepare(); }
  });
  await store.restore();
  await preparation;
  unsubscribe();
  expect(store.getSnapshot().state).toBe('ready');
  expect(files.download).toHaveBeenCalledTimes(assets.length);
});
test('cancelling a queued prepare while restore checks prevents a late download', async () => {
  const { store, files } = fixture();
  let finish;
  files.exists = jest.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const restoring = store.restore();
  await Promise.resolve();
  const preparing = store.prepare();
  store.cancel(); finish(false);
  await Promise.all([restoring, preparing]);
  expect(files.download).not.toHaveBeenCalled();
  expect(store.getSnapshot().state).toBe('missing');
});
test('concurrent prepare requests share one set of downloads', async () => {
  const { store, files } = fixture();
  await Promise.all([store.prepare(), store.prepare(), store.restore(), store.prepare()]);
  expect(store.getSnapshot().state).toBe('ready');
  expect(files.download).toHaveBeenCalledTimes(assets.length);
});
test('continue requested while an aborted transfer settles starts a fresh verified preparation', async () => {
  const { store, files } = fixture();
  let finish;
  files.download.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = store.prepare();
  while (!finish) { await Promise.resolve(); }
  store.cancel();
  const continued = store.prepare();
  finish();
  await Promise.all([first, continued]);
  expect(store.getSnapshot().state).toBe('ready');
  expect(files.download).toHaveBeenCalledTimes(assets.length + 1);
});
test('pausing during final file promotion leaves a resumable state', async () => {
  const { store, files } = fixture();
  const move = files.move;
  let finish;
  files.move = async (from, to) => {
    if (to.endsWith(`/${assets.at(-1).id}`)) {
      await new Promise(resolve => { finish = resolve; });
    }
    await move(from, to);
  };
  const preparing = store.prepare();
  while (!finish) { await Promise.resolve(); }
  store.cancel();
  finish();
  await preparing;
  expect(store.getSnapshot().state).toBe('missing');
  await store.prepare();
  expect(store.getSnapshot().state).toBe('ready');
});
