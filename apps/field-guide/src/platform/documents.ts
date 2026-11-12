/** Manufacturer document identity and verified local availability. */
export interface CourseDocument {
  readonly id: string;
  readonly title: string;
  readonly edition: string;
  readonly issued: string;
  readonly pages: number;
  /** PDF page minus printed page: cited pages are printed numbers, the viewer counts PDF pages. */
  readonly pageOffset: number;
  readonly available: boolean;
}

/** The native adapter verifies bundled bytes again before presenting a local PDF. */
export interface CourseDocuments {
  list(): Promise<readonly CourseDocument[]>;
  /** Opens at the printed page when given, otherwise at the start. */
  open(id: string, page?: number): Promise<void>;
}

/** The native module counts PDF pages from one and opens at the start for null. */
export interface NativeCourseDocuments {
  list(): Promise<readonly CourseDocument[]>;
  open(id: string, pdfPage: number | null): Promise<void>;
}

export function createCourseDocuments(
  native: NativeCourseDocuments | undefined,
): CourseDocuments {
  return {
    list: () => native?.list() ?? Promise.resolve([]),
    async open(id, page) {
      const entries = await native?.list();
      const entry = entries?.find(item => item.id === id && item.available);
      if (!native || !entry) {
        throw new Error('This document is not available on this device.');
      }
      if (page === undefined) {
        await native.open(id, null);
        return;
      }
      const pdfPage = page + entry.pageOffset;
      if (!Number.isInteger(pdfPage) || pdfPage < 1 || pdfPage > entry.pages) {
        throw new Error(`Page ${page} is not in ${entry.edition}.`);
      }
      await native.open(id, pdfPage);
    },
  };
}
