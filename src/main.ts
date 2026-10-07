import '@fontsource/barlow/400.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './styles.css';
import { loadSettings } from './config/settings';
import { Game } from './game/game';

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2'));
  } catch {
    return false;
  }
}

const app = document.getElementById('app')!;
if (!webglAvailable()) {
  app.innerHTML = '<div class="fatal">Endless Peek needs WebGL 2. Try a recent Chrome, Edge or Firefox with hardware acceleration on.</div>';
} else {
  const debug = new URLSearchParams(location.search).has('debug');
  const game = new Game(app, loadSettings(), { debug });
  if (debug) (window as unknown as { __ep: unknown }).__ep = game.debugApi();
}
