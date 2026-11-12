/** Text is prepared outside the phone; every result retains the original PDF identity and page. */
export interface ManualSource {
  readonly id: string;
  readonly title: string;
  readonly edition: string;
  readonly issued: string;
  readonly file: string;
  readonly sha256: string;
  readonly copyright: string;
  readonly pages: number;
}
export interface ManualPage {
  readonly number: number;
  readonly text: string;
}
export interface ManualDocument extends Omit<ManualSource, 'pages'> {
  readonly pages: readonly ManualPage[];
}
export interface ManualPassage {
  readonly documentId: string;
  readonly title: string;
  readonly edition: string;
  readonly sourceSha256: string;
  readonly pdfPage: number;
  readonly text: string;
}
export interface ManualIndex {
  readonly documents: readonly ManualDocument[];
  search(
    query: string,
    documentId?: string,
    limit?: number,
  ): readonly ManualPassage[];
  page(documentId: string, pdfPage: number): ManualPassage | null;
}
const STOP = new Set(
  'a an and are as at be by can could do does for from how i in is it me my of on or please show tell that the their this to what when where which with would you'.split(
    ' ',
  ),
);
const tokens = (text: string) =>
  text
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter(word => !STOP.has(word))
    .map(word => (word.length >= 6 ? word.slice(0, 5) : word)) ?? [];
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const fields = [
  'id',
  'title',
  'edition',
  'issued',
  'file',
  'sha256',
  'copyright',
] as const;
export function openManualIndex(
  value: unknown,
  sources: readonly ManualSource[],
): ManualIndex {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.documents) ||
    value.documents.length !== sources.length
  )
    throw new Error('Invalid manual index');
  const documents = value.documents.map((item: unknown) => {
    if (!record(item)) throw new Error('Invalid manual document');
    const source = sources.find(candidate => candidate.id === item.id);
    if (
      !source ||
      fields.some(key => item[key] !== source[key]) ||
      !Array.isArray(item.pages) ||
      item.pages.length !== source.pages
    )
      throw new Error(
        'Manual source identity differs from the retained catalog',
      );
    const pages = item.pages.map((page: unknown, index: number) => {
      if (
        !record(page) ||
        page.number !== index + 1 ||
        typeof page.text !== 'string'
      )
        throw new Error('Invalid manual page');
      return { number: index + 1, text: page.text };
    });
    return { ...source, pages };
  });
  if (new Set(documents.map(document => document.id)).size !== sources.length)
    throw new Error('Duplicate manual identity');
  const stats = (text: string) => {
    const words = tokens(text);
    const counts = new Map<string, number>();
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
    return { words: new Set(words), counts, length: words.length };
  };
  const pages = documents.flatMap(document =>
    document.pages.map(page => ({
      document,
      page,
      ...stats(page.text),
    })),
  );
  const averageLength =
    pages.reduce((sum, page) => sum + page.length, 0) /
    Math.max(1, pages.length);
  const frequency = new Map<string, number>();
  for (const page of pages)
    for (const word of page.words)
      frequency.set(word, (frequency.get(word) ?? 0) + 1);
  const passage = (
    document: ManualDocument,
    page: ManualPage,
    text = page.text,
  ): ManualPassage => ({
    documentId: document.id,
    title: document.title,
    edition: document.edition,
    sourceSha256: document.sha256,
    pdfPage: page.number,
    text,
  });
  return {
    documents,
    page(documentId, pdfPage) {
      const document = documents.find(item => item.id === documentId);
      const page = document?.pages.find(item => item.number === pdfPage);
      return document && page ? passage(document, page) : null;
    },
    search(query, documentId, limit = 3) {
      const asked = [...new Set(tokens(query))];
      if (!asked.length) return [];
      const score = (entry: ReturnType<typeof stats>) =>
        asked.reduce((total, word) => {
          const count = entry.counts.get(word) ?? 0;
          if (!count) return total;
          const idf = Math.log(1 + pages.length / (frequency.get(word) ?? 1));
          return (
            total +
            10 +
            (idf * count * 2.2) /
              (count +
                1.2 *
                  (0.25 + (0.75 * entry.length) / Math.max(1, averageLength)))
          );
        }, 0);
      return pages
        .filter(entry => !documentId || entry.document.id === documentId)
        .map(entry => ({ ...entry, score: score(entry) }))
        .filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.min(5, Math.max(0, limit)))
        .map(entry => {
          const paragraphs = entry.page.text.split(/\n\s*\n/);
          const ranked = paragraphs
            .map((text, index) => ({
              index,
              score: score(stats(text)),
            }))
            .sort((a, b) => b.score - a.score);
          const at = ranked[0]?.index ?? 0;
          const text = paragraphs
            .slice(Math.max(0, at - 1), Math.min(paragraphs.length, at + 2))
            .join('\n\n');
          return passage(entry.document, entry.page, text);
        });
    },
  };
}
/** The hosted index uses exactly the same prepared pages that local search consumes. */
export function manualTextDocuments(index: ManualIndex) {
  return index.documents.map(document => ({
    key: `manual:${document.id}`,
    name: `${document.title}, ${document.edition}`,
    text: document.pages
      .map(page =>
        [
          `Source document: ${document.id}. Edition: ${document.edition}. Issued: ${document.issued}. PDF page: ${page.number}.`,
          `Source PDF SHA-256: ${document.sha256}. ${document.copyright}`,
          'This source describes its own KUKA model family, not a confirmed installed Miris model. Preserve model applicability and source qualifications.',
          page.text,
        ].join('\n'),
      )
      .join('\n\n'),
  }));
}
