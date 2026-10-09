import { Game } from './Game.js';

const game = new Game(document.getElementById('game'));
const STEP = 1 / 120;
let lastTime = null;
let accumulator = 0;
let frameId;

// requestAnimationFrame dibuja; pasos fijos mantienen estable la física y las colisiones.
function frame(timestamp) {
  if (lastTime === null) lastTime = timestamp;
  const elapsed = Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime = timestamp;
  if (game.state === 'playing') {
    accumulator += elapsed;
    while (accumulator >= STEP) {
      game.update(STEP);
      accumulator -= STEP;
    }
  } else {
    accumulator = 0;
  }
  game.render();
  frameId = requestAnimationFrame(frame);
}

// Al regresar de otra pestaña descartamos el tiempo transcurrido fuera del juego.
document.addEventListener('visibilitychange', () => {
  lastTime = null;
  accumulator = 0;
});
window.addEventListener('pagehide', (event) => {
  cancelAnimationFrame(frameId);
  if (!event.persisted) game.destroy();
});
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  lastTime = null;
  accumulator = 0;
  frameId = requestAnimationFrame(frame);
});

frameId = requestAnimationFrame(frame);
