import './ui/styles.css';
import { Game } from './core/Game';
import { Stage } from './render/SceneSetup';

const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
if (!canvas) throw new Error('Canvas #scene not found');

try {
  const game = new Game(canvas);

  // Optional overrides: ?quality=low|medium|high pins the render tier,
  // ?validate runs the procedural-fairness harness.
  const params = new URLSearchParams(location.search);
  const quality = params.get('quality');
  if (quality === 'low' || quality === 'medium' || quality === 'high') {
    const stage = (game as unknown as { stage: Stage }).stage;
    stage.setQuality(quality);
    stage.lockQuality();
  }

  game.start();

  if (params.has('validate')) {
    void import('./dev/validateGeneration').then((m) => {
      (window as unknown as { validation: unknown }).validation = m.validateGeneration();
    });
  }

  (window as unknown as { game: Game }).game = game;
} catch (error) {
  console.error(error);
  document.getElementById('loading')?.classList.add('is-done');
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;inset:0;display:grid;place-items:center;padding:32px;text-align:center;' +
    'font:14px/1.6 system-ui,sans-serif;color:#e8eeff;background:#070b18;z-index:99';
  panel.innerHTML =
    '<div><h1 style="font-size:20px;letter-spacing:.12em;margin-bottom:10px">WEBGL UNAVAILABLE</h1>' +
    '<p style="opacity:.6;max-width:34ch">Nocturne needs hardware-accelerated WebGL. ' +
    'Try a different browser or enable GPU acceleration.</p></div>';
  document.body.appendChild(panel);
}
