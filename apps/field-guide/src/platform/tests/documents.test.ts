import { createCourseDocuments } from '../documents';

test('opens only a verified available local document by its catalog identity', async () => {
  const native = {
    list: jest.fn(async () => [
      {
        id: 'kuka-quantec-extra-v4',
        title: 'Operating instructions',
        edition: 'BA KR QUANTEC extra V4 en',
        issued: '2012-11-29',
        pages: 243,
        available: true,
      },
      {
        id: 'kuka-quantec-2-kp-v6',
        title: 'Assembly instructions',
        edition: 'MA KR QUANTEC-2 K+P V6',
        issued: '2024-01-26',
        pages: 400,
        available: false,
      },
    ]),
    open: jest.fn(async () => undefined),
  };
  const documents = createCourseDocuments(native);
  expect(await documents.list()).toHaveLength(2);
  await documents.open('kuka-quantec-extra-v4');
  expect(native.open).toHaveBeenCalledWith('kuka-quantec-extra-v4');
  await expect(documents.open('kuka-quantec-2-kp-v6')).rejects.toThrow(
    'not available',
  );
  await expect(documents.open('../arbitrary.pdf')).rejects.toThrow(
    'not available',
  );
  expect(native.open).toHaveBeenCalledTimes(1);
});

test('an unavailable platform exposes no local documents and rejects opening', async () => {
  const documents = createCourseDocuments(undefined);
  expect(await documents.list()).toEqual([]);
  await expect(documents.open('kuka-quantec-extra-v4')).rejects.toThrow(
    'not available',
  );
});
