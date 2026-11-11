import { Pack, Part, Procedure, ProcedureId, Relation, Step } from './pack';

/** Reserved: an authored procedure may not take it. */
export const TOUR_ID: ProcedureId = 'tour';
export const TOUR_TITLE = 'Parts tour';

const RADIANS_PER_DEGREE = Math.PI / 180;

/** Introduce each machine, then its components, before moving to another machine. */
export function tourOf(
  pack: Pick<Pack, 'parts' | 'camera'> & { relations?: readonly Relation[] },
): Procedure {
  const azimuth = pack.camera.home.azimuth * RADIANS_PER_DEGREE;
  const across = (part: Part) =>
    part.anchor[0] * Math.cos(azimuth) - part.anchor[2] * Math.sin(azimuth);
  const byId = new Map(pack.parts.map(part => [part.id, part]));
  const children = new Map<string | null, Part[]>();
  for (const part of pack.parts) {
    const parent =
      part.parent !== null && byId.has(part.parent) ? part.parent : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(part);
    children.set(parent, siblings);
  }
  const carries = (pack.relations ?? []).filter(
    relation => relation.type === 'carries' || relation.type === 'supports',
  );
  const ordered: Part[] = [];
  const seen = new Set<string>();
  function visit(part: Part) {
    if (seen.has(part.id)) return;
    seen.add(part.id);
    ordered.push(part);
    const members = children.get(part.id) ?? [];
    const ids = new Set(members.map(member => member.id));
    const links = carries.filter(
      relation => ids.has(relation.from) && ids.has(relation.to),
    );
    const carried = new Set(links.map(relation => relation.to));
    function chain(member: Part) {
      if (seen.has(member.id)) return;
      visit(member);
      for (const link of links.filter(
        relation => relation.from === member.id,
      )) {
        chain(byId.get(link.to)!);
      }
    }
    // Follow supplied kinematic links within this machine; proximity never assigns ownership.
    members.filter(member => !carried.has(member.id)).forEach(chain);
    members.forEach(chain);
  }
  [...(children.get(null) ?? [])]
    .sort((a, b) => across(a) - across(b))
    .forEach(visit);
  // Defensive for hand-built packs; the parser already rejects hierarchy cycles.
  pack.parts.forEach(visit);
  const steps: Step[] = ordered.map(part => ({
    id: part.id,
    text: part.summary,
    parts: [part.id],
    caution: '',
  }));
  return { id: TOUR_ID, title: TOUR_TITLE, steps };
}
