import type { Pack } from './pack';

export type GuideId = string;

export const Category = {
  equipment: 'equipment',
} as const;
export type Category = (typeof Category)[keyof typeof Category];

export const CATEGORY_TITLE: Readonly<Record<Category, string>> = {
  [Category.equipment]: 'Equipment',
};

export const GuideStatus = {
  ready: 'ready',
} as const;
export type GuideStatus = (typeof GuideStatus)[keyof typeof GuideStatus];

interface GuideBase {
  readonly id: GuideId;
  readonly category: Category;
  /** The equipment, e.g. "equipment name". */
  readonly title: string;
  /** Where on the equipment, e.g. "equipment area". */
  readonly area: string;
  readonly image?: number;
}

export interface ReadyGuide extends GuideBase {
  readonly status: typeof GuideStatus.ready;
  /** Model details, e.g. "equipment description". */
  readonly subtitle: string;
  readonly pack: Pack;
}

export type Guide = ReadyGuide;

/** Catalog entries come only from explicitly supplied, validated packs. */
export function catalogFor(pack?: Pack): readonly Guide[] {
  return pack
    ? [
        {
          id: pack.packId,
          status: GuideStatus.ready,
          category: Category.equipment,
          title: pack.title,
          subtitle: '',
          area: '',
          pack,
        },
      ]
    : [];
}

export function findReadyGuide(
  catalog: readonly Guide[],
  id: GuideId,
): ReadyGuide | undefined {
  const guide = catalog.find(candidate => candidate.id === id);
  return guide?.status === GuideStatus.ready ? guide : undefined;
}

const SPLATS_PER_MILLION = 1_000_000;

export interface PackFacts {
  readonly splats: string;
}

export function packFacts(pack: Pack): PackFacts {
  const tier = pack.tiers[0];
  return {
    splats: `${(tier.splatCount / SPLATS_PER_MILLION).toFixed(1)}M`,
  };
}
