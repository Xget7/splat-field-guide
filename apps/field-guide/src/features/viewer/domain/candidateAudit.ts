import type { SplatViewSpec } from 'react-native-splat';
import { currentStep, framingFor, type SessionState } from '../../guide';
import type { Bounds, FrameDirection, Pack } from '../../pack/pack';
import { guideFrameBounds, homeDirectionInRadians } from './camera';
import { measureFraming } from './framingAudit';
import type { Size } from './screenGeometry';

export interface ViewCandidate {
  id: number;
  direction: FrameDirection;
  cpu: { captureSupport: number; diffusePixelFraction: number };
}
export interface CandidateSet {
  key: string;
  parts: string[];
  state: SessionState;
  candidates: ViewCandidate[];
}
export interface CandidateInput {
  packId: string;
  packVersion: number;
  geometry: { world: string; labels: string };
  viewport: Size;
  sets: CandidateSet[];
}
export type CandidateMeasurement = ViewCandidate & {
  milliseconds: number;
  drawnDirection: FrameDirection;
  targets: (Awaited<ReturnType<typeof measureFraming>> & { partId: string })[];
};
export interface CandidateReport {
  packId: string;
  packVersion: number;
  geometry: CandidateInput['geometry'];
  viewport: Size;
  sets: { key: string; parts: string[]; candidates: CandidateMeasurement[] }[];
  complete: boolean;
  error?: string;
}
const PICK_BATCH = 8;
const POSE_TIMEOUT_MS = 2000;
const DEGREES = 180 / Math.PI;
const nextFrame = () =>
  new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

async function firstFrameAt(
  view: SplatViewSpec,
  bounds: Bounds,
  direction: FrameDirection,
  check: () => void,
) {
  // The mutation is queued to the render thread. Two display ticks and a published-pose
  // check avoid reading the previous target's frame, including when azimuth is unchanged.
  await nextFrame();
  await nextFrame();
  const centre = new Float32Array(
    bounds.min.map((n, i) => (n + bounds.max[i]) / 2),
  );
  const projected = new Float32Array(2);
  const deadline = Date.now() + POSE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    check();
    const drawn = view.drawnDirection();
    view.project(centre.buffer, projected.buffer);
    if (drawn) {
      const azimuth = drawn.azimuth * DEGREES;
      const elevation = drawn.elevation * DEGREES;
      const delta = ((azimuth - direction.azimuth + 540) % 360) - 180;
      if (
        Math.abs(delta) < 0.05 &&
        Math.abs(elevation - direction.elevation) < 0.05 &&
        Math.abs(projected[0] - 0.5) < 0.002 &&
        Math.abs(projected[1] - 0.5) < 0.002
      ) {
        return { azimuth, elevation };
      }
    }
    await nextFrame();
  }
  throw new Error(`Candidate pose was not drawn: ${JSON.stringify(direction)}`);
}

/** Native picks decide visibility; CPU fields are carried unchanged for later quality ranking. */
export async function measureCandidateSets(
  view: SplatViewSpec,
  pack: Pack,
  size: Size,
  input: CandidateInput,
  activate: (state: SessionState) => void,
  check: () => void,
  report: CandidateReport,
) {
  if (
    input.packId !== pack.packId ||
    input.packVersion !== pack.packVersion ||
    input.geometry.world !== pack.tiers[0].world.sha256 ||
    input.geometry.labels !== pack.tiers[0].labels.sha256 ||
    input.viewport.width !== size.width ||
    input.viewport.height !== size.height
  ) {
    throw new Error(
      'Candidate pack geometry or viewport differs from the active viewer',
    );
  }
  for (const set of input.sets) {
    check();
    const state = set.state;
    const roots =
      state.selectedPart === null
        ? currentStep(state, pack)?.parts
        : [state.selectedPart];
    if (
      JSON.stringify([...(roots ?? [])].sort()) !==
      JSON.stringify([...set.parts].sort())
    ) {
      throw new Error(`Candidate target set differs from session: ${set.key}`);
    }
    const bounds = framingFor(state, pack);
    if (!bounds) throw new Error(`No bounds for ${set.key}`);
    activate(state);
    await nextFrame();
    const result: CandidateReport['sets'][number] = {
      key: set.key,
      parts: set.parts,
      candidates: [],
    };
    report.sets.push(result);
    for (const candidate of set.candidates) {
      check();
      const started = Date.now();
      view.frame(
        guideFrameBounds(bounds),
        0,
        homeDirectionInRadians(candidate.direction),
      );
      const drawnDirection = await firstFrameAt(
        view,
        bounds,
        candidate.direction,
        check,
      );
      const targets: CandidateMeasurement['targets'] = [];
      for (const partId of set.parts) {
        const part = pack.parts.find(p => p.id === partId);
        if (!part) throw new Error(`Unknown candidate part ${partId}`);
        targets.push({
          partId,
          ...(await measureFraming(
            view,
            part.bounds,
            { ...state, selectedPart: partId },
            pack,
            PICK_BATCH,
          )),
        });
      }
      check();
      const measured = {
        ...candidate,
        drawnDirection,
        targets,
        milliseconds: Date.now() - started,
      };
      result.candidates.push(measured);
      console.log(
        `FRAMING_CANDIDATE ${JSON.stringify({
          key: set.key,
          id: candidate.id,
          milliseconds: measured.milliseconds,
          minimum: Math.min(...targets.map(t => t.visibleFraction)),
        })}`,
      );
    }
  }
  report.complete = true;
}
