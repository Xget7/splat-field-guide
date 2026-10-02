import { Bounds, Pack, Part, PartLabel, partsWithin, Vec3 } from './pack';
import { currentStep, SessionState } from './session';

/** The parts to show: the selection if any, else the step's, each with the parts inside. */
function partsToShow(state: SessionState, pack: Pack): readonly Part[] {
  const roots =
    state.selectedPart !== null
      ? [state.selectedPart]
      : currentStep(state, pack)?.parts ?? [];
  const byId = new Map<string, Part>();
  roots.forEach(id =>
    partsWithin(pack, id).forEach(part => byId.set(part.id, part)),
  );
  return [...byId.values()];
}

export function highlightFor(
  state: SessionState,
  pack: Pack,
): readonly PartLabel[] {
  return partsToShow(state, pack)
    .map(part => part.label)
    .sort((a, b) => a - b);
}

export function framingFor(state: SessionState, pack: Pack): Bounds | null {
  // With no procedure and nothing picked, the whole capture is what is being looked at.
  const overview = state.procedureId === null && state.selectedPart === null;
  const parts = overview ? pack.parts : partsToShow(state, pack);
  if (parts.length === 0) {
    return null;
  }
  const axis = (
    pick: (b: Bounds) => Vec3,
    better: (a: number, b: number) => number,
  ) =>
    [0, 1, 2].map(i =>
      parts.reduce(
        (acc, part) => better(acc, pick(part.bounds)[i]),
        pick(parts[0].bounds)[i],
      ),
    ) as unknown as Vec3;
  return {
    min: axis(b => b.min, Math.min),
    max: axis(b => b.max, Math.max),
  };
}
