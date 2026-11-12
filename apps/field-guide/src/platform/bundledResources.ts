import { Platform } from 'react-native';
type BundleFiles = typeof import('react-native-blob-util').default.fs;
// Load on the first file read, so importing the app does not initialize native file events.
const files = (): BundleFiles =>
  (require('react-native-blob-util') as typeof import('react-native-blob-util'))
    .default.fs;
export interface ResourceIdentity {
  readonly bytes: number;
  readonly sha256: string;
}
const MAX_RESOURCE_BYTES = 16 * 1024 * 1024;
function resourcePath(relative: string, fs: BundleFiles) {
  if (
    relative.startsWith('/') ||
    relative.split('/').some(part => !part || part === '.' || part === '..')
  )
    throw new Error('Invalid bundled resource path');
  return Platform.OS === 'android'
    ? fs.asset(relative)
    : `${fs.dirs.MainBundleDir}/${relative}`;
}
export async function readBundledText(
  relative: string,
  expected?: ResourceIdentity,
): Promise<string> {
  const fs = await files();
  const path = resourcePath(relative, fs);
  if (
    expected &&
    (expected.bytes > MAX_RESOURCE_BYTES ||
      (await fs.hash(path, 'sha256')) !== expected.sha256)
  )
    throw new Error('Bundled text digest differs from preparation');
  const text: unknown = await fs.readFile(path, 'utf8');
  if (typeof text !== 'string' || text.length > MAX_RESOURCE_BYTES)
    throw new Error('Invalid bundled text');
  return text;
}
export async function readBundledBytes(
  relative: string,
  expected: ResourceIdentity,
): Promise<ArrayBuffer> {
  const fs = await files();
  const path = resourcePath(relative, fs);
  if (
    expected.bytes > MAX_RESOURCE_BYTES ||
    (await fs.hash(path, 'sha256')) !== expected.sha256
  )
    throw new Error('Bundled vector digest differs from the manifest');
  const data: unknown = await fs.readFile(path, 'ascii');
  if (
    !Array.isArray(data) ||
    data.length !== expected.bytes ||
    !data.every(
      value => Number.isInteger(value) && value >= -128 && value <= 255,
    )
  )
    throw new Error('Invalid bundled vector bytes');
  // The native file readers return signed bytes; Uint8Array preserves their original bit pattern.
  return Uint8Array.from(data).buffer;
}
export async function verifyBundledResource(
  relative: string,
  sha256: string,
): Promise<void> {
  const fs = await files();
  if ((await fs.hash(resourcePath(relative, fs), 'sha256')) !== sha256)
    throw new Error('Bundled PDF differs from the retained source');
}
