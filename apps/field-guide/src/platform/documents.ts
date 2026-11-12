/** Manufacturer document identity and verified local availability. */
export interface CourseDocument {
  readonly id: string;
  readonly title: string;
  readonly edition: string;
  readonly issued: string;
  readonly pages: number;
  readonly available: boolean;
}

/** The native adapter verifies bundled bytes again before presenting a local PDF. */
export interface CourseDocuments {
  list(): Promise<readonly CourseDocument[]>;
  open(id: string): Promise<void>;
}

export function createCourseDocuments(
  native: CourseDocuments | undefined,
): CourseDocuments {
  return {
    list: () => native?.list() ?? Promise.resolve([]),
    async open(id) {
      const entries = await native?.list();
      if (!entries?.some(entry => entry.id === id && entry.available)) {
        throw new Error('This document is not available on this device.');
      }
      await native!.open(id);
    },
  };
}
