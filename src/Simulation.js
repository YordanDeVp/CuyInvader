import { Game } from './Game.js';
import { MAX_RUN_EVENTS, MAX_RUN_STEPS, RULES_VERSION, SIMULATION_STEP, validWorld } from './RunReplay.js';

// La misma física del navegador, sin canvas, sonido ni acceso al DOM.
export function createSimulation(token, width = 1200, height = 800) {
  const game = Object.create(Game.prototype);
  game.canvas = { width, height, focus() {} };
  game.assets = {};
  game.ui = { announcement: { textContent: '' } };
  game.input = { direction: 0, fire: false, clear() { this.direction = 0; this.fire = false; },
    isDown(code) { return code === 'Space' && this.fire; } };
  game.syncUI = game.syncHUD = game.beginGameSession = () => {};
  game.reset('playing', token);
  return game;
}

export function validateReplay(replay) {
  if (!replay || typeof replay !== 'object' || Object.keys(replay).some((key) => !['version', 'world', 'steps', 'events'].includes(key)) ||
      replay.version !== RULES_VERSION || !Array.isArray(replay.world) ||
      replay.world.length !== 2 || !validWorld(...replay.world) ||
      !Number.isInteger(replay.steps) || replay.steps < 1 || replay.steps > MAX_RUN_STEPS ||
      !Array.isArray(replay.events) || replay.events.length > MAX_RUN_EVENTS) return false;
  let previousTick = -1;
  for (const event of replay.events) {
    if (!Array.isArray(event)) return false;
    const [tick, kind, a, b] = event;
    if (!Number.isInteger(tick) || tick < previousTick || tick < 0 || tick >= replay.steps) return false;
    previousTick = tick;
    if (kind === 'i' && event.length === 4 && [-1, 0, 1].includes(a) && [0, 1].includes(b)) continue;
    if (['p', 'u'].includes(kind) && event.length === 3 && [0, 1].includes(a)) continue;
    if (kind === 'r' && event.length === 4 && validWorld(a, b)) continue;
    return false;
  }
  return true;
}

export function replayRun(token, replay) {
  if (!validateReplay(replay)) throw new Error('invalid-replay');
  const game = createSimulation(token, ...replay.world);
  game.recorder = null; // Una comprobación no genera otro registro.
  let cursor = 0;
  for (let tick = 0; tick < replay.steps; tick += 1) {
    while (replay.events[cursor]?.[0] === tick) {
      const [, kind, a, b] = replay.events[cursor++];
      if (kind === 'i') { game.input.direction = a; game.input.fire = Boolean(b); }
      if (kind === 'p') {
        if (game.state !== 'playing') throw new Error('invalid-power-state');
        if (game.player.powerCount(a === 0 ? 'jalapeno' : 'missile') === 0 || (a === 0 && game.player.powerTime > 0)) throw new Error('unavailable-power');
        game.activatePowerUp(a === 0 ? 'jalapeno' : 'missile');
      }
      if (kind === 'u') {
        if (game.state !== 'upgrade_menu') throw new Error('invalid-upgrade-state');
        game.applyUpgrade(a === 0 ? 'speed' : 'damage');
      }
      if (kind === 'r') {
        game.resizeWorld(a, b);
        if (game.state === 'paused') game.state = 'playing';
      }
    }
    if (game.state !== 'playing') throw new Error('invalid-run-state');
    game.update(SIMULATION_STEP);
  }
  if (game.state !== 'over') throw new Error('unfinished-run');
  return { score: game.score, wave: game.wave };
}
