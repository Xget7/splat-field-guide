import { manualTextDocuments, openManualIndex } from '../index';
const source = {
  id: 'kuka-v1',
  title: 'Synthetic KUKA manual',
  edition: 'V1',
  issued: '2026-01-01',
  file: 'manual.pdf',
  sha256: 'a'.repeat(64),
  copyright: 'Synthetic notice',
  pages: 2,
};
const value = {
  schemaVersion: 1,
  documents: [
    {
      ...source,
      pages: [
        { number: 1, text: 'Introduction\n\nRobot overview and components.' },
        {
          number: 2,
          text: 'Maintenance\n\nA5 wrist motor inspection.\n\nWarning: synthetic isolation instruction.',
        },
      ],
    },
  ],
};
test('full manual search and hosted text retain the identical source, page and warning', () => {
  const index = openManualIndex(value, [source]);
  const [match] = index.search('Where is the A5 wrist motor?', undefined, 1);
  expect(match).toMatchObject({
    documentId: source.id,
    edition: 'V1',
    sourceSha256: source.sha256,
    pdfPage: 2,
  });
  expect(match.text).toContain('synthetic isolation');
  expect(index.search('nonexistentword')).toEqual([]);
  expect(index.page(source.id, 1)?.text).toBe(value.documents[0].pages[0].text);
  expect(index.page(source.id, 3)).toBeNull();
  const [hosted] = manualTextDocuments(index);
  for (const page of value.documents[0].pages)
    expect(hosted.text).toContain(page.text);
  expect(hosted.text).toContain('PDF page: 2');
  expect(hosted.text).toContain(source.copyright);
});
test('a different source digest, edition or incomplete page inventory is rejected', () => {
  for (const document of [
    { ...value.documents[0], sha256: 'b'.repeat(64) },
    { ...value.documents[0], edition: 'V2' },
    { ...value.documents[0], pages: value.documents[0].pages.slice(1) },
  ]) {
    expect(() =>
      openManualIndex({ ...value, documents: [document] }, [source]),
    ).toThrow();
  }
});

test('a request prefix naming the manual cannot outrank the actual subject', () => {
  const index = openManualIndex(
    {
      schemaVersion: 1,
      documents: [
        {
          ...source,
          pages: [
            { number: 1, text: 'A5 axis. A5 is a wrist axis.' },
            {
              number: 2,
              text: 'According to the KUKA manual, the A5 drive has manual service instructions for the motor.',
            },
          ],
        },
      ],
    },
    [source],
  );
  expect(
    index.search(
      'According to the KUKA manual, what is axis A5?',
      undefined,
      1,
    )[0].pdfPage,
  ).toBe(1);
});
