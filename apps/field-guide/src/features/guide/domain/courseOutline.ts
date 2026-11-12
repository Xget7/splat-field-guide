import {
  Audience,
  type DocumentReference,
  type Pack,
  type PartId,
  type Procedure,
  type ProcedureId,
} from '../../pack/pack';
import { TOUR_ID } from '../../pack/tour';
import type { CourseDocument } from '../../../platform/documents';
// Readouts list their facts with commas; domain rules cannot import the UI's copy of this.
const SEPARATOR = ', ';

export const AUDIENCE_LABEL: Readonly<Record<Audience, string>> = {
  [Audience.operator]: 'Operator',
  [Audience.maintenance]: 'Maintenance',
  [Audience.specialist]: 'Specialist',
};

/** One startable procedure. */
export interface ModuleRow {
  readonly id: ProcedureId;
  readonly title: string;
  readonly objective?: string;
  /** Audience and step count, such as "Operator, 7 steps". */
  readonly meta: string;
}

export interface MachineSection {
  readonly id: PartId;
  readonly name: string;
  /** What the machine does, from its root part's summary; empty when unauthored. */
  readonly task: string;
  readonly modules: readonly ModuleRow[];
}

/** What the parts tour covers, shown beside the button that starts it. */
export interface TourSummary {
  readonly objective?: string;
  /** Such as "44 steps". */
  readonly steps: string;
}

export interface CourseOutline {
  /** The start button owns the tour, so the lists never repeat it. */
  readonly tour: TourSummary | null;
  /** Whole-cell procedures. */
  readonly startHere: readonly ModuleRow[];
  readonly machines: readonly MachineSection[];
}

function stepsLabel(procedure: Procedure): string {
  const count = procedure.steps.length;
  return `${count} ${count === 1 ? 'step' : 'steps'}`;
}

function moduleRow(procedure: Procedure): ModuleRow {
  return {
    id: procedure.id,
    title: procedure.title,
    objective: procedure.objective,
    meta: [
      procedure.audience && AUDIENCE_LABEL[procedure.audience],
      stepsLabel(procedure),
    ]
      .filter(Boolean)
      .join(SEPARATOR),
  };
}

/** Groups the course into the tour, whole-cell modules and one section per machine, each module once. */
export function courseOutlineFor(pack: Pack): CourseOutline {
  const tour = pack.procedures.find(procedure => procedure.id === TOUR_ID);
  return {
    tour: tour ? { objective: tour.objective, steps: stepsLabel(tour) } : null,
    startHere: pack.procedures
      .filter(
        procedure =>
          procedure.id !== TOUR_ID && procedure.machine === undefined,
      )
      .map(moduleRow),
    machines: pack.parts
      .filter(part => part.parent === null)
      .map(part => ({
        id: part.id,
        name: part.name,
        task: part.summary,
        modules: pack.procedures
          .filter(procedure => procedure.machine === part.id)
          .map(moduleRow),
      })),
  };
}

/** Edition, section, figure and printed page, such as "MA KR QUANTEC-2 K+P V6, Sec. 2.2, Fig. 2-2, p. 16". */
export function referenceMeta(
  reference: DocumentReference,
  document: CourseDocument | undefined,
): string {
  return [
    document?.edition,
    reference.section && `Sec. ${reference.section}`,
    reference.figure,
    `p. ${reference.page}`,
  ]
    .filter(Boolean)
    .join(SEPARATOR);
}
