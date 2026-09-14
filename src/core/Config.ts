/**
 * Road Surfers — tuning constants.
 * Everything a designer would want to touch lives here; nothing else
 * in the codebase hard-codes gameplay numbers.
 */

// ── Track geometry ──────────────────────────────────────────────────
export const LANE_WIDTH = 2.25;
export const LANE_X: readonly number[] = [-LANE_WIDTH, 0, LANE_WIDTH];
export const LANE_COUNT = 3;

export const TRACK_WIDTH = 9.6;
export const SEGMENT_LENGTH = 24; // metres of deck per pooled segment

/** How far ahead of the player the world is populated. */
export const VIEW_DISTANCE = 260;
/** Objects further behind the player than this are recycled. The deck
 *  and hazards must survive past the camera (which sits ~6 m back). */
export const DESPAWN_BEHIND = 11;
/** Coins are retired much sooner: an uncollected coin drifting between
 *  the player and the camera fills the screen for no reason. */
export const DESPAWN_COIN = 4.5;

// ── Player physics ──────────────────────────────────────────────────
export const GRAVITY = 34;
export const JUMP_VELOCITY = 10.4;      // apex ≈ 1.59 m, airtime ≈ 0.61 s
export const FAST_FALL_GRAVITY = 62;
export const LANE_CHANGE_TIME = 0.15;   // seconds, lane→lane
export const SLIDE_TIME = 0.58;

/**
 * The runner is drawn at 70% of the height the track was first tuned
 * for. The collider and every height-sensitive hazard derive from this
 * so what you see is always what collides.
 */
export const PLAYER_SCALE = 0.7;
export const PLAYER_HALF_WIDTH = 0.32;
export const PLAYER_HALF_DEPTH = 0.3;
export const PLAYER_STAND_HEIGHT = 1.62 * PLAYER_SCALE; // 1.13
export const PLAYER_SLIDE_HEIGHT = 0.78 * PLAYER_SCALE; // 0.55

/** Underside of overhead hazards: clear of a slide, in the way of a run. */
export const OVERHEAD_CLEARANCE = 0.88;
/** Top of low hazards: must be jumped. */
export const LOW_HAZARD_HEIGHT = 0.72;

/** Forgiveness windows that make controls feel responsive. */
export const INPUT_BUFFER = 0.14;
export const COYOTE_TIME = 0.09;

// ── Speed & difficulty ──────────────────────────────────────────────
export const SPEED_START = 12.5;
export const SPEED_MAX = 29;
/** Seconds of play to reach SPEED_MAX (eased, not linear). */
export const SPEED_RAMP_TIME = 190;

/** Distance (m) at which each difficulty tier unlocks. */
export const TIER_DISTANCE: readonly number[] = [0, 320, 800, 1500, 2600];

// ── Scoring ─────────────────────────────────────────────────────────
export const POINTS_PER_METRE = 1;
export const POINTS_PER_COIN = 10;
export const POINTS_NEAR_MISS = 15;

// ── Power-ups ───────────────────────────────────────────────────────
export const MAGNET_DURATION = 8;
export const MAGNET_RADIUS = 7;
export const SHIELD_DURATION = 14;
export const SURGE_DURATION = 6.5;
export const SURGE_SPEED_BONUS = 5.5;
export const SURGE_MULTIPLIER = 2;

// ── Collectibles ────────────────────────────────────────────────────
export const COIN_Y = 0.9;
/** Vertical centre of the pickup volume, relative to the player's feet. */
export const COIN_PICKUP_CENTRE = 0.6;
export const COIN_PICKUP_X = 0.78;
export const COIN_PICKUP_Y = 0.95;
export const COIN_PICKUP_Z = 0.7;

// ── Camera ──────────────────────────────────────────────────────────
export const CAMERA_OFFSET = { x: 0, y: 2.55, z: 5.4 };
export const CAMERA_LOOK_AHEAD = 7.0;
export const CAMERA_FOV_BASE = 62;
export const CAMERA_FOV_MAX = 74;

// ── Rendering ───────────────────────────────────────────────────────
export const FOG_NEAR = 45;
export const FOG_FAR = 235;
export const MAX_PIXEL_RATIO = 1.75;
/**
 * Phones report a device pixel ratio of 3 or more. Honouring it would
 * mean shading nine times the fragments of a 1× buffer for a display
 * small enough that the difference is invisible.
 */
export const MAX_PIXEL_RATIO_TOUCH = 1.5;

/**
 * The aspect the camera framing was tuned at. Narrower viewports widen
 * the vertical FOV to hold the same horizontal view, so the outer lanes
 * never fall off the sides of a phone in landscape.
 */
export const REFERENCE_ASPECT = 16 / 9;
export const CAMERA_FOV_CEILING = 90;

export const STORAGE_KEY = 'road-surfers.best.v1';
export const STORAGE_MUTE = 'road-surfers.mute.v1';
export const STORAGE_SCHEME = 'road-surfers.scheme.v1';
export const STORAGE_FULLSCREEN = 'road-surfers.fullscreen.v1';
