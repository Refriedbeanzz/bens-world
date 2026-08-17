import type { WorldSpec } from './world';

// The battlefield roster. A map is pure data — the future custom-map editor
// writes these same specs.
export const MAPS: Record<string, { name: string; spec: WorldSpec }> = {
  meadow: {
    name: 'Meadow Clash',
    spec: { biome: 'meadow', relief: 'rolling', treeClusters: [7, 10], rocks: [10, 16] },
  },
  steppe: {
    name: 'Steppe Expanse',
    spec: { biome: 'steppe', relief: 'rolling', treeClusters: [2, 4], rocks: [6, 10] },
  },
  ridge: {
    name: 'The Ridge',
    spec: { biome: 'meadow', relief: 'ridge', treeClusters: [5, 8], rocks: [8, 12] },
  },
  canyon: {
    name: 'Canyon Pass',
    spec: { biome: 'steppe', relief: 'canyon', treeClusters: [2, 3], rocks: [6, 9] },
  },
  greenwood: {
    name: 'Greenwood',
    spec: { biome: 'forest', relief: 'rolling', treeClusters: [16, 20], rocks: [8, 12] },
  },
};
