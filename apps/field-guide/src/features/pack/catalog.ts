import type { Pack } from './pack';

export type GuideId = string;

export const Category = {
  vehicles: 'vehicles',
  aviation: 'aviation',
  energy: 'energy',
  oilAndGas: 'oilAndGas',
} as const;
export type Category = (typeof Category)[keyof typeof Category];

export const CATEGORY_TITLE: Readonly<Record<Category, string>> = {
  [Category.vehicles]: 'Vehicles',
  [Category.aviation]: 'Aviation',
  [Category.energy]: 'Energy',
  [Category.oilAndGas]: 'Oil & gas',
};

export const GuideStatus = {
  ready: 'ready',
  comingSoon: 'comingSoon',
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
  /** The one rule to follow before touching the equipment. */
  readonly safety: string;
  /** A USDZ model in the iOS app bundle that turns in the library; the image stands in elsewhere. */
  readonly model?: string;
  readonly pack: Pack;
}

/** Coming-soon guides have no pack and cannot be opened. */
export interface ComingSoonGuide extends GuideBase {
  readonly status: typeof GuideStatus.comingSoon;
}

export type Guide = ReadyGuide | ComingSoonGuide;

const COMING_SOON: readonly ComingSoonGuide[] = [
  {
    id: 'tactical-truck-engine-bay',
    status: GuideStatus.comingSoon,
    category: Category.vehicles,
    title: 'Tactical truck',
    area: 'Engine bay',
    image: require('../../../assets/guides/soon-tactical-truck.png'),
  },
  {
    id: 'rotorcraft-rotor-head',
    status: GuideStatus.comingSoon,
    category: Category.aviation,
    title: 'Rotorcraft',
    area: 'Main rotor head',
    image: require('../../../assets/guides/soon-rotorcraft.png'),
  },
  {
    id: 'generator-set-panel',
    status: GuideStatus.comingSoon,
    category: Category.energy,
    title: 'Generator set',
    area: 'Control panel',
    image: require('../../../assets/guides/soon-generator.png'),
  },
  {
    id: 'drilling-rig-top-drive',
    status: GuideStatus.comingSoon,
    category: Category.oilAndGas,
    title: 'Drilling rig',
    area: 'Top drive',
    image: require('../../../assets/guides/soon-drilling-rig.png'),
  },
];

/** Put the bundled guide before guides awaiting capture. */
export function catalogFor(golTrend: Pack): readonly Guide[] {
  return [
    {
      id: golTrend.packId,
      status: GuideStatus.ready,
      category: Category.vehicles,
      title: 'Volkswagen Gol Trend',
      subtitle: '2010, 1.6 8V petrol',
      area: 'Engine bay',
      safety: 'Engine off and cold before you touch anything.',
      // A frame of this pack as the app renders it, from the iOS simulator.
      image: require('../../../assets/guides/gol-trend-engine-bay.jpg'),
      // Built from the AR capture by scripts/make_preview_model.sh.
      model: 'ar/gol-trend-engine-bay/turntable.usdz',
      pack: golTrend,
    },
    ...COMING_SOON,
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
