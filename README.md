# Nocturne

A 3D endless runner for desktop browsers. You are a courier on an elevated
maglev line through a twilight megacity, and the line does not stop.

Built with Vite, TypeScript and Three.js. No art assets, no audio files — every
mesh, texture and sound is generated at runtime.

```bash
npm install
npm run dev      # http://localhost:5173
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server with HMR |
| `npm run build` | Type-check, then production bundle into `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run validate` | Prove every obstacle pattern is solvable at every speed |
| `npm run soak` | Headless play-through with a solver-driven bot |
| `npm test` | All three of the above |

URL flags: `?quality=low\|medium\|high` pins the render tier, `?validate` runs the
fairness harness in the browser console.

## Controls

| Action | Keys |
| --- | --- |
| Move left | `A` · `←` |
| Move right | `D` · `→` |
| Jump | `W` · `↑` · `Space` |
| Slide | `S` · `↓` |
| Pause | `Esc` · `P` |
| Restart | `R` |
| Mute | `M` |

Sliding can be cancelled into a jump, and pressing slide in mid-air fast-falls
and slides the moment you land. Jump and slide inputs are buffered for 140 ms,
so a press made just before landing still fires.

## Visual direction

Three colours carry meaning and nothing else is allowed to use them:

- **Cyan** — you, the track, anything safe. Lane seams, rail lights, the
  runner's chest bar and visor.
- **Amber** — reward. Sparks (the coins) and nothing else.
- **Coral** — danger. Every hazard chassis and every warning stripe.

Everything is flat-shaded low-poly against a deep indigo void, lit by a single
shadow-casting key, a cool rim and a sky bounce, with a restrained half-
resolution bloom on the emissive trim. Hazards carry a **chevron on the face you
see first** — up means jump, down means slide, opposed arrows mean go around —
so the required verb is legible from sixty metres out, long before the shape is.

The run alternates between open city and enclosed tunnel sections. Entering a
tunnel pulls the fog in from 45–235 m to 22–120 m and drops the sky bounce,
which changes the feel of the space without ever hiding a hazard.

## Architecture

The world scrolls past a runner who never moves in Z. Every entity stores a
player-relative `z` that is advanced by the same per-frame delta, so there is no
growing world offset and no floating-point drift on a long run.

```
src/
  core/        Game · GameLoop · GameState · Config · Random · ObjectPool · MathUtils
  render/      SceneSetup (Stage) · CameraController · Materials · Geometries ·
               PartBuilder · Palette · Sky
  player/      Player · PlayerMovement · PlayerModel
  input/       InputManager
  world/       TrackManager · ProceduralGenerator · Patterns · PathSolver ·
               ObstacleTypes · ObstacleManager · CollectibleManager ·
               EnvironmentManager · TrackBuilder
  systems/     CollisionSystem · DifficultyManager · ScoreSystem ·
               PowerUpSystem · ParticleSystem
  audio/       AudioManager
  ui/          UIManager · styles.css
  dev/         validateGeneration · soak · Autopilot   (test harnesses only)
```

`Game` is the only place subsystems meet; the dependency graph is a star, not a
web. Notable files:

| File | Responsibility |
| --- | --- |
| `core/Game.ts` | Phase machine and per-frame orchestration |
| `core/Config.ts` | Every tuning number in the game, in one place |
| `world/PathSolver.ts` | Reachability search that decides what is fair |
| `world/Patterns.ts` | The authored gameplay vocabulary — 35 patterns |
| `world/ProceduralGenerator.ts` | Picks, validates and places the next stretch |
| `player/PlayerMovement.ts` | Kinematics and posture state machine (no Three.js) |
| `systems/CollisionSystem.ts` | Swept AABB tests (no Three.js) |
| `render/PartBuilder.ts` | Builds props from primitives, merges them per material |

`PlayerMovement` and `CollisionSystem` deliberately have no rendering
dependency, which is what lets the headless soak test drive the real gameplay
code with no renderer in the loop.

## Procedural generation

The track is emitted one **chunk** at a time. A chunk is a reaction gap followed
by an authored **pattern** — a small declarative record of obstacle placements
and coin trails:

```ts
{
  id: 'forced-slide', length: 22, tier: 2, weight: 8,
  obstacles: [
    { type: 'beamWide', lane: 1, z: 8 },   // blocks lanes 1–2 overhead
    { type: 'pylon',    lane: 0, z: 8 },   // blocks lane 0 outright
  ],
  coins: [{ lane: 2, z: 3, count: 8, gap: 1.4 }],
}
```

The generator picks a pattern by weight (de-weighting whatever it just used),
mirrors it left/right at random to double the effective library, validates it,
and places it. Coin trails expand into individual coins, with `arc` trails
following the actual jump parabola so the reward lines up with the input.

Everything is pooled: hazards, coins, power-ups, deck segments, arch gates,
tunnel ribs and particles. Coins are a single `InstancedMesh`, so several
hundred of them cost one draw call. The skyline is two more instanced meshes.
After the first few hundred metres, the main loop allocates nothing.

## How obstacle fairness is maintained

This is enforced, not hoped for.

**1 · Every pattern is proved solvable before it can spawn.** Each candidate is
compiled into a lane-occupancy grid (0.25 m slices × 3 lanes, each cell marked
*clear / jumpable / slideable / blocked*) and run through a breadth-first
reachability search over the player's real state space — lane × posture ×
lane-transition — using the same gravity, jump velocity, slide duration and
lane-change time as the player controller. The jump's clearance window is
derived from the actual arc, not assumed.

A pattern ships only if a route exists **from every starting lane**, because the
generator cannot know which lane the player will arrive in.

**2 · With margin.** Validation runs at 1.14× the real speed, so every pattern
carries spare distance. A pattern that only just works frame-perfectly is not
fair to a person, and it gets rejected.

**3 · Composition is guaranteed too.** A per-pattern proof is worthless if
patterns can chain into something impossible. The gap in front of every pattern
is at least `jump airtime × speed`, so a jump taken at the previous pattern's
last metre has always landed before the next one begins — which is exactly the
grounded entry state the solver assumed. The validator asserts this ratio stays
above 1.0 (it currently measures 1.34×).

**4 · Moving hazards are modelled conservatively.** A patrol drone is entered in
the grid as blocking both lanes it can reach for its whole length, and a sweeper
as blocking all three overhead — so the solved route never depends on timing a
moving object, and reality is always easier than the model.

**5 · Results are memoised** per (pattern, mirrored, speed bucket), so the cost
is paid once per combination rather than once per spawn.

If no candidate passes, the generator falls back to a hazard-free coin run
rather than shipping something unfair.

### Verification

`npm run validate` proves all 35 patterns and their mirrors solvable across the
whole speed range — 1,260 solver runs, zero failures.

`npm run soak` goes further: it runs the real generator, the real movement code
and the real collision system against a bot that plans with the same solver, and
on any collision it re-checks whether a surviving route existed a second
earlier. Only a genuine dead end fails the test — a bot mistake says the fixture
played badly, not that the track was unfair. Six seeds × 14 km (≈ 8½ minutes of
play each, ~3,700 obstacles) produce **zero dead ends**.

## Difficulty progression

Difficulty is a function of time and distance, never of randomness.

- **Speed** eases from 12.5 to 29 m/s over 190 s on a `1 − (1 − t)^2.1` curve:
  quick early gains so the run gets going, flattening near the top so the
  ceiling is a plateau you can master rather than a wall.
- **Tier** unlocks by distance — 0 / 320 / 800 / 1500 / 2600 m — and gates the
  pattern pool: tier 0 teaches one verb at a time, tier 1 chains two, tier 2
  forces actions and introduces moving hazards, tier 3 overlaps timing windows,
  tier 4 builds corridors and stacks. Patterns can also *expire* (`maxTier`) so
  trivial ones stop diluting the late game.
- **Reaction gap** shrinks from 0.95 s to 0.52 s of travel between patterns.
- **Coin density and power-up frequency** rise with tier.

Nothing about the ramp is random, so two runs of the same length feel equally
hard — and the fairness solver re-validates every pattern at the new speed as it
climbs, so difficulty never crosses into impossibility.

## Power-ups

| | Effect |
| --- | --- |
| **Magnet** | 8 s — draws coins in from 7 m |
| **Shield** | 14 s — absorbs one hit and turns it into a stumble |
| **Surge** | 6.5 s — +5.5 m/s and double score |

They spawn in the reaction gap, which is guaranteed clear.

## Audio

Everything is synthesised with the Web Audio API at runtime — a four-chord loop
in A minor with a plucked arpeggio and a soft pulse, whose filter cutoff and
tempo follow the player's speed, plus one-shot effects for jump, landing, slide,
lane change, pickup, near-miss, shield break, crash and UI. Collected coins walk
up a pentatonic ladder that resets after a pause, so a coin run resolves
musically.

The context is created on the first user gesture (browser autoplay policy) and
every method degrades to a no-op if Web Audio is unavailable, so the game is
fully playable without sound.

## Performance

Measured at tier 4 / 29 m/s with the world fully populated: **~137 draw calls,
~10k triangles, 73 geometries, 5 textures, 34 shader programs.**

Decisions behind that:

- **Props are merged per material.** A hazard is authored as a dozen primitives
  for silhouette detail, then collapsed into two or three meshes — and each
  merged buffer is built once per type and *shared* by every pooled instance.
- **Emissive trim never casts shadows.** It sits inside the prop's own
  silhouette, so shadowing it would double the shadow pass for no visible
  difference. One shadow-casting light, with a 2048 map on a small ortho frustum
  that follows the player.
- **Instancing where the count is high** — coins, near buildings, their window
  bands and the far skyline.
- **No dynamic lights.** Power-up halos are additive sprites; adding and
  removing real point lights forces material recompiles, and a stutter is worse
  than a physically-correct falloff.
- **Bloom runs at half resolution** with a high threshold, so only the neon
  trim blooms and never the deck.
- **The HUD is written only when a value changes.** String formatting and layout
  every frame at 144 Hz shows up as jank long before the renderer does.
- **Adaptive quality**: if the frame rate sits below 46 fps for 2.5 s the
  renderer drops a tier — bloom strength and shadow resolution first, then post
  and shadows entirely. One-way, so it never oscillates mid-run.
- **Delta time is clamped** to 50 ms, and collision is swept in Z, so a
  backgrounded tab cannot teleport the player through a wall on return.

## Known limitations

- Desktop and laptop only by design — there are no touch controls.
- The soak bot occasionally misplays a two-lane wall at top speed (≈ 0.4% of
  hazards). A route always exists, so this is a limit of the test fixture's
  30 Hz replanning, not of the generated track.
- Frame timings above are CPU-side; GPU cost is not directly measurable from
  script, though the geometry and fill budgets are small enough that it is
  unlikely to dominate on any modern laptop.
- The bloom pass has no dirt/lens texture and no temporal stability pass, so
  very fast lateral motion can shimmer slightly on high-contrast trim.
