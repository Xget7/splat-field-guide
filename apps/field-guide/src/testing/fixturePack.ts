import { Pack } from '../features/pack/pack';
import { parsePack } from '../features/pack/parsePack';

const box = (x: number) => ({ min: [x, 0, 0], max: [x + 1, 1, 1] });
const part = (
  id: string,
  label: number,
  name: string,
  x: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  label,
  parent: null,
  name,
  aliases: [],
  summary: `${name} summary`,
  details: '',
  bounds: box(x),
  anchor: [x, 0, 0],
  ...extra,
});
const step = (id: string, parts: string[], caution = '') => ({
  id,
  text: `Step ${id}`,
  parts,
  caution,
});

export const fixtureManifest = {
  schemaVersion: 1,
  packId: 'fixture',
  packVersion: 1,
  title: 'Fixture engine bay',
  tiers: [
    {
      id: 'high',
      splatCount: 10,
      cloud: { path: 'high/cloud.spz', bytes: 1, sha256: 'a' },
      labels: { path: 'high/labels.bin', bytes: 1, sha256: 'b' },
    },
  ],
  camera: {
    home: { azimuth: 0, elevation: 35, radius: 1.2 },
    limits: {
      minAzimuth: -90,
      maxAzimuth: 90,
      minElevation: 10,
      maxElevation: 80,
      minRadius: 0.25,
      maxRadius: 2.5,
    },
  },
  parts: [
    part('coolant-reservoir', 1, 'Coolant reservoir', 0, {
      aliases: ['coolant tank', 'expansion tank'],
      notes: [
        { topic: 'identity', text: 'It is the expansion tank.' },
        {
          topic: 'safety',
          text: 'Never open the cap while the engine is hot.',
        },
      ],
    }),
    part('power-steering-reservoir', 2, 'Power steering reservoir', 2),
    part('brake-fluid-reservoir', 3, 'Brake fluid reservoir', 4, {
      aliases: ['brake reservoir'],
    }),
    part('battery', 4, 'Battery', 6, {
      notes: [
        { topic: 'identity', text: 'It is a 12 volt lead acid battery.' },
        { topic: 'purpose', text: 'It supplies the starter motor.' },
        {
          topic: 'faults',
          text: 'A battery that keeps going flat needs a charging check.',
        },
        { topic: 'safety', text: 'Keep sparks away from the terminals.' },
      ],
    }),
    part('fuse-box', 5, 'Fuse box', 8, { aliases: ['fuses'] }),
    part('engine', 6, 'Engine', 10, {
      bounds: { min: [10, 0, 0], max: [14, 3, 3] },
    }),
    part('valve-cover', 7, 'Valve cover', 10, { parent: 'engine' }),
    part('intake-manifold', 8, 'Intake manifold', 12, { parent: 'engine' }),
  ],
  procedures: [
    {
      id: 'check-coolant',
      title: 'Check the coolant level',
      steps: [
        step('engine-cold', ['engine'], 'Only with the engine cold.'),
        step('locate', ['coolant-reservoir']),
        step('read-level', ['coolant-reservoir']),
      ],
    },
    {
      id: 'check-brake-fluid',
      title: 'Check the brake fluid level',
      steps: [
        step('locate', ['brake-fluid-reservoir']),
        step('read-level', ['brake-fluid-reservoir']),
      ],
    },
    {
      id: 'check-power-steering-fluid',
      title: 'Check the power steering fluid level',
      steps: [
        step('locate', ['power-steering-reservoir']),
        step('read-level', ['power-steering-reservoir']),
      ],
    },
  ],
};

export function fixtureCopy(): Record<string, any> {
  return JSON.parse(JSON.stringify(fixtureManifest));
}

export function fixturePack(): Pack {
  const result = parsePack(fixtureManifest);
  if (!result.ok) {
    throw new Error(`fixture pack is invalid: ${result.error.message}`);
  }
  return result.pack;
}
