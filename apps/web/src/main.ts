import './ui/styles.css';
import { Game } from './game/Game';
import { loadCharacters } from './entities/models/Characters';

const bootStart = performance.now();
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const ui = document.getElementById('ui-root') as HTMLElement;
const loading = document.getElementById('boot-loading');

async function boot(): Promise<void> {
  // Character models and animations (~5 MB). If they can't load, the game falls back to its
  // procedural placeholder rigs rather than failing to start.
  if (loading) loading.textContent = 'Kindling the forge… loading characters';
  await loadCharacters((f) => {
    if (loading) loading.textContent = `Kindling the forge… loading characters ${Math.round(f * 100)}%`;
  });
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
}

void boot();
