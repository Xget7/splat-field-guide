import type { Pack } from './pack';

export type GuideId = string;

export const Category = {
  vehicles: 'vehicles',
} as const;
export type Category = (typeof Category)[keyof typeof Category];

export const CATEGORY_TITLE: Readonly<Record<Category, string>> = {
  [Category.vehicles]: 'Vehicles',
};

export const GuideStatus = {
  ready: 'ready',
} as const;
export type GuideStatus = (typeof GuideStatus)[keyof typeof GuideStatus];

interface GuideBase {
  readonly id: GuideId;
  readonly category: Category;
  /** The equipment, e.g. "Volkswagen Gol Trend". */
  readonly title: string;
  /** Where on the equipment, e.g. "Engine bay". */
  readonly area: string;
  readonly image: number;
}

export interface ReadyGuide extends GuideBase {
  readonly status: typeof GuideStatus.ready;
  /** Model details, e.g. "2010, 1.6 8V petrol". */
  readonly subtitle: string;
  /** A USDZ model in the iOS app bundle that turns in the library and the guide; the image stands in elsewhere. */
  readonly model?: string;
  readonly pack: Pack;
}

export type Guide = ReadyGuide;

/** Retain the usable bundled guide until reviewed Miris content replaces it. */
export function catalogFor(golTrend: Pack): readonly Guide[] {
  return [
    {
      id: golTrend.packId,
      status: GuideStatus.ready,
      category: Category.vehicles,
      title: 'Volkswagen Gol Trend',
      subtitle: '2010, 1.6 8V petrol',
      area: 'Engine bay',
      // A frame of this pack as the app renders it, from the iOS simulator.
      image: require('../../../assets/guides/gol-trend-engine-bay.jpg'),
      // Built from the AR capture by scripts/make_preview_model.sh.
      model: 'ar/gol-trend-engine-bay/turntable.usdz',
      pack: golTrend,
    },
  ];
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
