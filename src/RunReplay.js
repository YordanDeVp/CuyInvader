// Contrato compartido. Incrementar la versión cuando cambie la física o el balance.
export const RULES_VERSION = '2026-10-14-summon-exclusive-impostors';
export const SIMULATION_STEP = 1 / 120;
export const MAX_RUN_STEPS = 120 * 60 * 60;
export const MAX_RUN_EVENTS = 20000;

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// Leer parámetros públicos no valida la firma; esa tarea pertenece a Node.js.
export function sessionParameters(token) {
  const payload = JSON.parse(atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
  if (payload.rules !== RULES_VERSION || !Number.isInteger(payload.seed)) throw new Error('Actualiza el juego para iniciar una partida verificable.');
  return payload;
}

export function validWorld(width, height) {
  return (width === 600 && Number.isInteger(height) && height >= 320 && height <= 1400) ||
    (width === 1200 && height === 800);
}

export class RunRecorder {
  constructor(width, height) {
    this.world = [width, height];
    this.steps = 0;
    this.events = [];
    this.lastInput = '';
    this.valid = validWorld(width, height);
  }

  event(type, ...values) {
    if (this.events.length >= MAX_RUN_EVENTS || this.steps >= MAX_RUN_STEPS) { this.valid = false; return; }
    this.events.push([this.steps, type, ...values]);
  }

  step(input) {
    const direction = input.direction;
    const fire = input.isDown('Space') ? 1 : 0;
    const key = direction + ':' + fire;
    if (key !== this.lastInput) { this.event('i', direction, fire); this.lastInput = key; }
    this.steps += 1;
    if (this.steps > MAX_RUN_STEPS) this.valid = false;
  }

  export() {
    return this.valid ? { version: RULES_VERSION, world: [...this.world], steps: this.steps,
      events: this.events.map((event) => [...event]) } : null;
  }
}
