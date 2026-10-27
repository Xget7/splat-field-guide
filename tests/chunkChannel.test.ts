import { createChunkChannel } from '../apps/field-guide/src/platform/chunkChannel';

const FAILURE = new Error('transport failed');

async function read(
  chunks: AsyncIterable<string>,
  received: string[] = [],
): Promise<string[]> {
  for await (const chunk of chunks) {
    received.push(chunk);
  }
  return received;
}

test('delivers chunks pushed before and after the reader in order, then ends', async () => {
  const channel = createChunkChannel();
  channel.push('a');
  channel.push('b');
  const received = read(channel.chunks);
  await Promise.resolve();
  channel.push('c');
  channel.end();
  await expect(received).resolves.toEqual(['a', 'b', 'c']);
});

test('a failure after buffered chunks delivers them first, then rejects', async () => {
  const channel = createChunkChannel();
  const received: string[] = [];
  channel.push('a');
  channel.push('b');
  channel.fail(FAILURE);
  await expect(read(channel.chunks, received)).rejects.toBe(FAILURE);
  expect(received).toEqual(['a', 'b']);
});

test('a waiting reader rejects when the channel fails', async () => {
  const channel = createChunkChannel();
  const received = read(channel.chunks);
  await Promise.resolve();
  channel.fail(FAILURE);
  await expect(received).rejects.toBe(FAILURE);
});

test('ignores pushes, ends and failures after it closed', async () => {
  const channel = createChunkChannel();
  channel.push('a');
  channel.end();
  channel.push('late');
  channel.fail(FAILURE);
  await expect(read(channel.chunks)).resolves.toEqual(['a']);
});
