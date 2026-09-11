/**
 * Node entry point:  `npm run soak`
 * Runs several seeded end-to-end simulations with the solver-driven bot
 * and fails if any of them hit an obstacle.
 */
import { soak } from './soak';

declare const process: { exit(code: number): never; argv: string[] };

const metres = Number(process.argv[2] ?? 4000);
const seeds = [1, 7, 42, 1337, 90210, 2718281];

let failed = false;
for (const seed of seeds) {
  const started = Date.now();
  const r = soak(seed, metres);
  // Only a genuine dead end is a failure: a bot mistake says the test
  // fixture played badly, not that the track was unfair.
  const ok = r.deadEnds === 0;
  failed ||= !ok;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  seed ${String(seed).padStart(7)}  ` +
    `${r.survivedMetres}m in ${r.survivedSeconds}s  ` +
    `obstacles ${r.obstaclesPassed}  coins ${r.coinsPassed}  ` +
    `dead ends ${r.deadEnds}  bot mistakes ${r.botMistakes}  (${Date.now() - started}ms)`,
  );
  for (const d of r.deaths.slice(0, 8)) {
    console.log(
      `      ${d.genuineDeadEnd ? '✗ UNFAIR' : '· bot'} ${d.obstacle} lane ${d.lane} ` +
      `@ ${d.distance}m, ${d.speed} m/s, tier ${d.tier}`,
    );
  }
  if (r.deaths.length > 8) console.log(`      … ${r.deaths.length - 8} more`);
}

console.log(failed ? '\nSOAK FAILED — generator produced an unwinnable stretch'
  : '\nSOAK PASSED — every generated stretch had a surviving route');
if (failed) process.exit(1);
