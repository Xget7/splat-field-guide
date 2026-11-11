import type { OfflineModels, OfflineModelStatus } from 'react-native-on-device';
import { fakePlatform } from '@tests/platform';
import { createInstructor } from '../createInstructor';
import { createInstructorStore } from '../state/instructorStore';

const route = (satisfied: boolean) => ({
  satisfied,
  transport: 'wifi' as const,
  downstreamKbps: -1,
  signalLevel: -1,
});
const settle = async () => {
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }
};
function fixture(ready = false) {
  const fake = fakePlatform();
  let status: OfflineModelStatus = {
    state: 'checking',
    bytes: 100,
    progress: 0,
    error: null,
  };
  let finishRestore!: () => void;
  const restored = new Promise<void>(resolve => {
    finishRestore = resolve;
  });
  const models: OfflineModels = {
    getSnapshot: () => status,
    subscribe: () => () => {},
    restore: jest.fn(async () => {
      await restored;
      status = { ...status, state: ready ? 'ready' : 'missing' };
    }),
    prepare: jest.fn(async () => {
      status = { ...status, state: 'ready', progress: 1 };
    }),
    cancel: jest.fn(),
    release: jest.fn(),
  };
  const instructor = createInstructor({
    platform: { ...fake.platform, offlineModels: () => models },
    proxyUrl: null,
    store: createInstructorStore(),
  });
  return {
    ...fake,
    models,
    instructor,
    finishRestore,
    setStatus: (state: OfflineModelStatus['state']) => {
      status = { ...status, state };
    },
  };
}
test('startup verifies before automatically downloading, even without an online proxy', async () => {
  const f = fixture();
  f.instructor.start();
  f.instructor.start();
  f.network.emit(route(true));
  expect(f.models.restore).toHaveBeenCalledTimes(1);
  expect(f.models.prepare).not.toHaveBeenCalled();
  f.finishRestore();
  await settle();
  expect(f.models.prepare).toHaveBeenCalledTimes(1);
  f.network.emit(route(true));
  await settle();
  expect(f.models.prepare).toHaveBeenCalledTimes(1);
  f.instructor.stop();
});
test('offline startup waits for a route and verified files are reused', async () => {
  for (const ready of [false, true]) {
    const f = fixture(ready);
    f.instructor.start();
    f.network.emit(route(false));
    f.finishRestore();
    await settle();
    expect(f.models.prepare).not.toHaveBeenCalled();
    f.network.emit(route(true));
    await settle();
    expect(f.models.prepare).toHaveBeenCalledTimes(ready ? 0 : 1);
    f.instructor.stop();
  }
});
test('route recovery retries a failed download once without a retry loop', async () => {
  const f = fixture();
  jest.mocked(f.models.prepare).mockImplementation(async () => {
    f.setStatus('error');
    throw new Error('download failed');
  });
  f.instructor.start();
  f.network.emit(route(true));
  f.finishRestore();
  await settle();
  expect(f.models.prepare).toHaveBeenCalledTimes(1);
  f.network.emit(route(true));
  await settle();
  expect(f.models.prepare).toHaveBeenCalledTimes(1);
  f.network.emit(route(false));
  f.network.emit(route(true));
  await settle();
  expect(f.models.prepare).toHaveBeenCalledTimes(2);
  f.instructor.stop();
});
test('shutdown during verification never starts a late download', async () => {
  const f = fixture();
  f.instructor.start();
  f.network.emit(route(true));
  f.instructor.stop();
  f.finishRestore();
  await settle();
  expect(f.models.prepare).not.toHaveBeenCalled();
});

test('recovery during cancellation waits for the old transfer before retrying', async () => {
  const f = fixture();
  let finish!: () => void;
  jest.mocked(f.models.prepare).mockImplementationOnce(async () => {
    f.setStatus('downloading');
    await new Promise<void>(resolve => {
      finish = resolve;
    });
    f.setStatus('missing');
  });
  f.instructor.start();
  f.network.emit(route(true));
  f.finishRestore();
  await settle();
  f.network.emit(route(false));
  f.network.emit(route(true));
  expect(f.models.cancel).toHaveBeenCalledTimes(1);
  expect(f.models.prepare).toHaveBeenCalledTimes(1);
  finish();
  await settle();
  expect(f.models.prepare).toHaveBeenCalledTimes(2);
  f.instructor.stop();
});
test('manual cancellation is not immediately restarted on an unchanged route', async () => {
  const f = fixture();
  jest.mocked(f.models.prepare).mockImplementationOnce(async () => {
    f.setStatus('missing');
  });
  f.instructor.start();
  f.network.emit(route(true));
  f.finishRestore();
  await settle();
  f.network.emit(route(true));
  await settle();
  expect(f.models.prepare).toHaveBeenCalledTimes(1);
  f.instructor.stop();
});
