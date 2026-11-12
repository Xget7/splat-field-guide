import type { SplatViewSpec } from 'react-native-splat';
import { fixturePack } from '@tests/fixturePack';
import {
  measureCandidateSets,
  type CandidateInput,
  type CandidateReport,
} from '../domain/candidateAudit';
import { guideFrameBounds } from '../domain/camera';

beforeEach(() => {
  jest
    .spyOn(globalThis, 'requestAnimationFrame')
    .mockImplementation(callback => {
      Promise.resolve().then(() => callback(0));
      return 0;
    });
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

function fixture() {
  const base = fixturePack();
  const pack = {
    ...base,
    procedures: [
      {
        ...base.procedures[0],
        steps: base.procedures[0].steps.map((step, i) =>
          i === 0 ? { ...step, parts: ['engine', 'battery'] } : step,
        ),
      },
      ...base.procedures.slice(1),
    ],
  };
  const direction = { azimuth: 30, elevation: 35 };
  const size = { width: 982, height: 1024 };
  const input: CandidateInput = {
    packId: pack.packId,
    packVersion: pack.packVersion,
    geometry: {
      world: pack.tiers[0].world.sha256,
      labels: pack.tiers[0].labels.sha256,
    },
    viewport: size,
    sets: [
      {
        key: '["battery","engine"]',
        parts: ['battery', 'engine'],
        state: {
          procedureId: pack.procedures[0].id,
          stepIndex: 0,
          selectedPart: null,
        },
        candidates: [
          {
            id: 0,
            direction,
            cpu: { captureSupport: 0.9, diffusePixelFraction: 0.1 },
          },
        ],
      },
    ],
  };
  const report: CandidateReport = {
    ...input,
    sets: [],
    complete: false,
  };
  let poseReads = 0;
  let picks = 0;
  let inFlight = 0;
  let maximumInFlight = 0;
  const view = {
    frame: jest.fn(),
    drawnDirection: jest.fn(() => {
      poseReads++;
      return {
        azimuth: (poseReads < 3 ? 0 : direction.azimuth * Math.PI) / 180,
        elevation: (direction.elevation * Math.PI) / 180,
      };
    }),
    project: jest.fn((_points: ArrayBuffer, output: ArrayBuffer) => {
      const values = new Float32Array(output);
      values.fill(0.5);
      if (values.length > 2) {
        values[0] = 0.1;
        values[1] = 0.1;
        values[2] = 0.9;
        values[3] = 0.9;
      }
    }),
    pick: jest.fn(async () => {
      expect(poseReads).toBeGreaterThanOrEqual(3);
      inFlight++;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      const label = picks++ % 2 === 0 ? 4 : 7;
      await Promise.resolve();
      inFlight--;
      return label;
    }),
  };
  return {
    pack,
    size,
    input,
    report,
    view,
    native: view as unknown as SplatViewSpec,
    maximumInFlight: () => maximumInFlight,
  };
}

it('waits for the drawn pose and measures each target with the normal descendant scoring', async () => {
  const f = fixture();
  const activate = jest.fn();
  await measureCandidateSets(
    f.native,
    f.pack,
    f.size,
    f.input,
    activate,
    () => {},
    f.report,
  );
  expect(activate).toHaveBeenCalledWith(f.input.sets[0].state);
  expect(f.view.frame).toHaveBeenCalledWith(
    guideFrameBounds({ min: [6, 0, 0], max: [14, 3, 3] }),
    0,
    { azimuth: Math.PI / 6, elevation: (35 * Math.PI) / 180 },
  );
  expect(f.report.complete).toBe(true);
  const measured = f.report.sets[0].candidates[0];
  expect(measured.cpu).toEqual(f.input.sets[0].candidates[0].cpu);
  expect(measured.targets).toEqual([
    expect.objectContaining({
      partId: 'battery',
      samples: 144,
      visibleFraction: 0.5,
    }),
    expect.objectContaining({
      partId: 'engine',
      samples: 144,
      visibleFraction: 0.5,
    }),
  ]);
  expect(f.maximumInFlight()).toBe(8);
});

it('rejects geometry and session mismatches before framing or picking', async () => {
  for (const mismatch of ['geometry', 'session']) {
    const f = fixture();
    if (mismatch === 'geometry') f.input.geometry.labels = 'different';
    else f.input.sets[0].parts = ['engine'];
    await expect(
      measureCandidateSets(
        f.native,
        f.pack,
        f.size,
        f.input,
        jest.fn(),
        () => {},
        f.report,
      ),
    ).rejects.toThrow(/differs/);
    expect(f.view.frame).not.toHaveBeenCalled();
    expect(f.view.pick).not.toHaveBeenCalled();
    expect(f.report.complete).toBe(false);
  }
});

it('cancels before sampling a stale pose and leaves the report incomplete', async () => {
  const f = fixture();
  let checks = 0;
  await expect(
    measureCandidateSets(
      f.native,
      f.pack,
      f.size,
      f.input,
      jest.fn(),
      () => {
        if (++checks === 3) throw new Error('cancelled');
      },
      f.report,
    ),
  ).rejects.toThrow('cancelled');
  expect(f.view.pick).not.toHaveBeenCalled();
  expect(f.report.complete).toBe(false);
});
