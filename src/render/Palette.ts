/**
 * The entire game uses these colours and no others. Cyan reads as
 * "safe / you / the track", amber as "reward", coral as "danger".
 * Keeping the semantic mapping absolute is what makes obstacles
 * readable at speed.
 */
export const Palette = {
  void: 0x070b18,
  fog: 0x0b1224,

  deck: 0x121a33,
  rail: 0x232f57,
  seam: 0x4de3ff,

  building: 0x0c1124,
  buildingFar: 0x0a0e1e,
  window: 0x2b4a9e,

  player: 0xeaf2ff,
  playerDark: 0x0d1730,
  playerTrim: 0x4de3ff,

  hazard: 0x141a2e,
  hazardGlow: 0xff5470,
  hazardWarn: 0xff8a5c,

  coin: 0xffc65c,

  magnet: 0xff5cf0,
  shield: 0x4de3ff,
  surge: 0x8affd6,

  mint: 0x8affd6,
  cyan: 0x4de3ff,
} as const;

