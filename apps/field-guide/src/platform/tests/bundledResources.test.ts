import BlobUtil from 'react-native-blob-util';
import { readBundledBytes, readBundledText } from '../bundledResources';
jest.mock('react-native-blob-util', () => ({
  __esModule: true,
  default: {
    fs: {
      dirs: { MainBundleDir: '/bundle' },
      asset: (path: string) => `bundle-assets://${path}`,
      hash: jest.fn(),
      readFile: jest.fn(),
    },
  },
}));
beforeEach(() => jest.clearAllMocks());
test('verified native signed bytes retain the float-file bit pattern', async () => {
  jest.mocked(BlobUtil.fs.hash).mockResolvedValue('source-digest');
  jest.mocked(BlobUtil.fs.readFile).mockResolvedValue([0, -128, -1, 127]);
  const bytes = await readBundledBytes('packs/miris/1/semantic/vectors.f32', {
    bytes: 4,
    sha256: 'source-digest',
  });
  expect([...new Uint8Array(bytes)]).toEqual([0, 128, 255, 127]);
  expect(BlobUtil.fs.hash).toHaveBeenCalledWith(
    '/bundle/packs/miris/1/semantic/vectors.f32',
    'sha256',
  );
});
test('digest drift, path traversal and truncated vector files cannot become evidence', async () => {
  jest.mocked(BlobUtil.fs.hash).mockResolvedValue('different');
  await expect(
    readBundledBytes('packs/miris/1/vectors.f32', {
      bytes: 4,
      sha256: 'expected',
    }),
  ).rejects.toThrow('digest');
  expect(BlobUtil.fs.readFile).not.toHaveBeenCalled();
  await expect(readBundledText('../manuals.json')).rejects.toThrow('path');
  jest.mocked(BlobUtil.fs.hash).mockResolvedValue('expected');
  jest.mocked(BlobUtil.fs.readFile).mockResolvedValue([0]);
  await expect(
    readBundledBytes('packs/miris/1/vectors.f32', {
      bytes: 4,
      sha256: 'expected',
    }),
  ).rejects.toThrow('bytes');
});
