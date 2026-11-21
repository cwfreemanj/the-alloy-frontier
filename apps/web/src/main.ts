import './ui/styles.css';
import { Game } from './game/Game';

const bootStart = performance.now();
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const ui = document.getElementById('ui-root') as HTMLElement;
const loading = document.getElementById('boot-loading');

try {
  const game = new Game(canvas, ui);
  game.perf.loadMs = performance.now() - bootStart;
  // Navigation timing: time from navigation start to the first interactive frame.
  requestAnimationFrame(() => {
    game.perf.loadMs = performance.now();
    loading?.remove();
  });
} catch (e) {
  console.error(e);
  if (loading) loading.textContent = `Failed to start: ${(e as Error).message}. WebGL 2 is required.`;
}
