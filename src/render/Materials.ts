import * as THREE from 'three';
import { Palette } from './Palette';

/**
 * Shared material instances. Reusing materials keeps the shader-program
 * count tiny and lets three batch aggressively; nothing clones a
 * material per object.
 */
const surface = (color: number, roughness = 0.72, metalness = 0.05) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });

/** Lit surface with a constant self-glow, so a shape still reads as a
 *  solid silhouette when it is far enough out to be barely lit. */
const litGlow = (color: number, emissive: number, intensity: number, roughness = 0.6) =>
  new THREE.MeshStandardMaterial({
    color, emissive, emissiveIntensity: intensity, roughness, metalness: 0.3, flatShading: true,
  });

const glow = (color: number, opacity = 1) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    toneMapped: false, // keep neon at full punch through ACES
  });

export const Mat = {
  // Track
  deck: litGlow(Palette.deck, 0x0e1836, 0.55, 0.85),
  rail: surface(Palette.rail, 0.45, 0.55),
  seam: glow(Palette.seam, 0.85),

  // Environment
  building: surface(Palette.building, 0.9, 0.02),
  buildingFar: new THREE.MeshBasicMaterial({ color: Palette.buildingFar }),
  window: glow(Palette.window, 0.9),
  archFrame: surface(0x18213f, 0.55, 0.4),
  archGlow: glow(Palette.cyan, 0.7),

  // Player
  playerBody: surface(Palette.player, 0.36, 0.06),
  playerDark: surface(Palette.playerDark, 0.4, 0.35),
  playerTrim: glow(Palette.playerTrim, 1),

  // Hazards. The chassis carries a faint coral self-glow: at 60 m the
  // key light barely reaches it, and a hazard you can only see at 20 m
  // is not a hazard, it is an ambush.
  hazardBody: litGlow(Palette.hazard, Palette.hazardGlow, 0.13, 0.55),
  hazardStripe: glow(Palette.hazardGlow, 1),
  hazardWarn: glow(Palette.hazardWarn, 0.85),

  // Collectibles
  coin: new THREE.MeshStandardMaterial({
    color: Palette.coin,
    emissive: Palette.coin,
    emissiveIntensity: 0.85,
    roughness: 0.25,
    metalness: 0.6,
    flatShading: true,
  }),

  magnet: glow(Palette.magnet, 1),
  shield: glow(Palette.shield, 1),
  surge: glow(Palette.surge, 1),
  powerShell: new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.14,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  }),

  // Effects. The shield has to be unmistakable without hiding the
  // character it is protecting, so it is a wireframe shell over a very
  // faint fill rather than a solid dome.
  shieldBubble: new THREE.MeshBasicMaterial({
    color: Palette.cyan,
    transparent: true,
    opacity: 0.06,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
  }),
  shieldWire: new THREE.MeshBasicMaterial({
    color: Palette.cyan,
    transparent: true,
    opacity: 0.32,
    wireframe: true,
    depthWrite: false,
    toneMapped: false,
  }),
} as const;

/** Cached per-colour glow materials for particle bursts. */
const particleMats = new Map<number, THREE.MeshBasicMaterial>();
export function particleMaterial(color: number): THREE.MeshBasicMaterial {
  let m = particleMats.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      toneMapped: false,
    });
    particleMats.set(color, m);
  }
  return m;
}
