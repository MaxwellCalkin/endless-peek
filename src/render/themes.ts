/**
 * Color zones for the hallway. The hallway changes zone every few segments so long runs
 * don't blur together. Palettes are original; they only borrow the general mood of
 * VALORANT-style maps (warm plaster, desert sandstone, coastal white/teal, icy steel, temple stone).
 */
export interface Theme {
  name: string;
  wall: string;
  wallNoise: string;
  accent: string;
  floor: string;
  floorLine: string;
  crate: string;
  crateEdge: string;
  crateAlt: string;
  crateAltEdge: string;
  metal: string;
  platform: string;
  skyTop: string;
  skyHorizon: string;
  sun: string;
  ambientSky: string;
  ambientGround: string;
  /** Height and thickness of the painted wall stripe in meters (0 = none). */
  stripeY: number;
  stripeH: number;
}

export const THEMES: Theme[] = [
  {
    name: 'Range',
    wall: '#d9dde2',
    wallNoise: '#c4cad1',
    accent: '#ff4655',
    floor: '#8e98a3',
    floorLine: '#78828d',
    crate: '#3b4757',
    crateEdge: '#ffb52e',
    crateAlt: '#5d6d80',
    crateAltEdge: '#e8eef3',
    metal: '#99a3ad',
    platform: '#b7bec6',
    skyTop: '#5d93d6',
    skyHorizon: '#cfe3f5',
    sun: '#fff4e2',
    ambientSky: '#cfe0f5',
    ambientGround: '#7d7368',
    stripeY: 1.05,
    stripeH: 0.12,
  },
  {
    name: 'Sandstone',
    wall: '#dcc39b',
    wallNoise: '#c9ab7e',
    accent: '#c4683d',
    floor: '#c3a77e',
    floorLine: '#a68b65',
    crate: '#7a5233',
    crateEdge: '#b0814f',
    crateAlt: '#3f6e8c',
    crateAltEdge: '#79a9c4',
    metal: '#8b8f92',
    platform: '#cdb38b',
    skyTop: '#4f8fd0',
    skyHorizon: '#f2dcb8',
    sun: '#fff0d4',
    ambientSky: '#e9dcc4',
    ambientGround: '#8a6e4e',
    stripeY: 0,
    stripeH: 0,
  },
  {
    name: 'Harbor',
    wall: '#ebe3d3',
    wallNoise: '#d8cdb8',
    accent: '#3b8b88',
    floor: '#9d907d',
    floorLine: '#857967',
    crate: '#8b5a33',
    crateEdge: '#c9a26b',
    crateAlt: '#a33f2f',
    crateAltEdge: '#df8b67',
    metal: '#7f8a8c',
    platform: '#d6c9b1',
    skyTop: '#4d8ccf',
    skyHorizon: '#d6ebf5',
    sun: '#fff6e8',
    ambientSky: '#d9e6ef',
    ambientGround: '#857560',
    stripeY: 0.9,
    stripeH: 0.18,
  },
  {
    name: 'Glacier',
    wall: '#c6d3de',
    wallNoise: '#b0bfcc',
    accent: '#e57a2e',
    floor: '#808c97',
    floorLine: '#6b7782',
    crate: '#2f5d7c',
    crateEdge: '#e57a2e',
    crateAlt: '#bac7d3',
    crateAltEdge: '#6b7782',
    metal: '#8f9ba6',
    platform: '#aab7c3',
    skyTop: '#6f9ccc',
    skyHorizon: '#e6eff6',
    sun: '#f4f8ff',
    ambientSky: '#dfe9f4',
    ambientGround: '#6f7a85',
    stripeY: 1.2,
    stripeH: 0.1,
  },
  {
    name: 'Temple',
    wall: '#dacdb6',
    wallNoise: '#c5b598',
    accent: '#5f8a3a',
    floor: '#8f8371',
    floorLine: '#7a6f5f',
    crate: '#6b4a2b',
    crateEdge: '#9b7344',
    crateAlt: '#4b5d3a',
    crateAltEdge: '#86a262',
    metal: '#78746e',
    platform: '#c5b59b',
    skyTop: '#5a8fc4',
    skyHorizon: '#eadfc8',
    sun: '#fff1da',
    ambientSky: '#e4dccb',
    ambientGround: '#7a6a55',
    stripeY: 0,
    stripeH: 0,
  },
];
