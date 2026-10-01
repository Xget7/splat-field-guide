import {
  CATEGORY_TITLE,
  Category,
  findReadyGuide,
  GuideStatus,
  type Guide,
  type ReadyGuide,
} from '../catalog/catalog';
import { findProcedure, type Procedure } from '../domain/pack';
import type { Progress } from '../progress/progress';
import { stepLabel } from '../ui/readout';

export const LibraryCategory = { all: 'all', ...Category } as const;
export type LibraryCategory =
  (typeof LibraryCategory)[keyof typeof LibraryCategory];

export const LIBRARY_CATEGORIES = [
  LibraryCategory.all,
  ...Object.values(Category),
] as const;

const DIACRITICS = /\p{M}/gu;

function searchable(value: string): string {
  return value.normalize('NFD').replace(DIACRITICS, '').toLowerCase();
}

export function filterGuides(
  catalog: readonly Guide[],
  query: string,
  category: LibraryCategory,
): Guide[] {
  const needle = searchable(query.trim());
  return catalog.filter(guide => {
    if (category !== LibraryCategory.all && guide.category !== category) {
      return false;
    }
    const text = [
      guide.title,
      guide.area,
      CATEGORY_TITLE[guide.category],
      guide.status === GuideStatus.ready ? guide.subtitle : '',
    ].join(' ');
    return searchable(text).includes(needle);
  });
}

export interface ContinueRow {
  readonly guide: ReadyGuide;
  readonly procedure: Procedure;
  readonly stepIndex: number;
  readonly stepLabel: string;
  readonly fraction: number;
}

export function continueRowFor(
  catalog: readonly Guide[],
  progress: Progress | null,
): ContinueRow | null {
  if (!progress) {
    return null;
  }
  const guide = findReadyGuide(catalog, progress.guideId);
  const procedure = guide && findProcedure(guide.pack, progress.procedureId);
  if (
    !guide ||
    !procedure ||
    !Number.isInteger(progress.stepIndex) ||
    progress.stepIndex < 0 ||
    progress.stepIndex >= procedure.steps.length
  ) {
    return null;
  }
  const stepNumber = progress.stepIndex + 1;
  return {
    guide,
    procedure,
    stepIndex: progress.stepIndex,
    stepLabel: stepLabel(stepNumber, procedure.steps.length),
    fraction: stepNumber / procedure.steps.length,
  };
}
