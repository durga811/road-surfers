/**
 * Node entry point for the fairness harness:  `npm run validate`.
 * Bundled with esbuild so the TypeScript module graph resolves without
 * a browser. Exits non-zero when a pattern is unfair, which makes it
 * usable as a CI gate.
 */
import { validateGeneration } from './validateGeneration';

declare const process: { exit(code: number): never };

const report = validateGeneration();
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exit(1);
