// Comparación con el umbral histórico; ya no forma parte del servidor.
const minimumRunDurationMs = wave => 15000 + (wave - 1) * 15000;
// Diagnósticos de auditoría: no leen claves ni escriben en la base real.
import { once } from 'node:events';
import { Game } from '../src/Game.js';
import { createApp } from '../server.js';
import { getTopScores } from '../src/api.js';
import { Leaderboard } from '../src/Leaderboard.js';

function playWithAllowedInputs(width, height) {
  const game = Object.create(Game.prototype);
  game.canvas = { width, height, focus() {} };
  game.assets = {};
  game.ui = { announcement: { textContent: '' } };
  // Solo dirección -1/0/1 y Space. Posición, daño, vida y puntuación
  // se actualizan exclusivamente por las clases reales del juego.
  game.input = { direction: 0, clear() {}, isDown: (code) => code === 'Space' && game.wave < 3 };
  game.syncUI = game.syncHUD = game.beginGameSession = () => {};
  game.reset();
  let time = 0;
  while (game.state === 'playing' && time < 90) {
    if (game.wave < 3) {
      const aim = game.player.x + game.player.width * 0.75;
      const enemy = [...game.enemies].sort((a, b) =>
        Math.abs(a.x + a.width / 2 - aim) - Math.abs(b.x + b.width / 2 - aim))[0];
      if (enemy) {
        const desired = enemy.x + enemy.width / 2 + game.formation.direction * game.enemySpeed *
          (game.player.y - enemy.y) / 820;
        const dx = desired - aim;
        game.input.direction = Math.abs(dx) > enemy.width * 0.15 ? Math.sign(dx) : 0;
      }
    } else {
      const box = game.player.hitbox;
      const laser = [...game.enemyProjectiles].sort((a, b) => Math.abs(a.y - box.y) - Math.abs(b.y - box.y))[0];
      const dx = laser ? laser.x + laser.width / 2 - (box.x + box.width / 2) : 0;
      game.input.direction = Math.abs(dx) > 3 ? Math.sign(dx) : 0;
    }
    game.update(1 / 120);
    time += 1 / 120;
  }
  return { width, height, elapsedMs: Math.floor(time * 1000), wave: game.wave, state: game.state, score: game.score };
}

async function auditValidGameDuration() {
  let now = Date.UTC(2026, 9, 12);
  let inserts = 0;
  const db = { from() {
    let entry;
    const query = {
      insert(value) { entry = value; return query; },
      select() { return query; },
      single() { return query; },
      async abortSignal() {
        inserts += 1;
        return { data: { id: 'audit-row', ...entry }, error: null };
      },
    };
    return query;
  } };
  const server = createApp(db, { gameSessionSecret: 'audit-only-secret-not-for-production-32-bytes', now: () => now })
    .listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const size of [[1200, 800], [600, 800], [600, 500], [600, 400]]) {
      const result = playWithAllowedInputs(...size);
      const session = await (await fetch(base + '/api/start-session')).json();
      now += result.elapsedMs;
      const response = await fetch(base + '/api/scores', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Auditoria', score: result.score, wave: result.wave, runToken: session.token }),
      });
      console.log(JSON.stringify({ probe: 'game-over-with-allowed-inputs', ...result,
        minimumMs: minimumRunDurationMs(result.wave), apiStatus: response.status }));
    }
    console.log(JSON.stringify({ probe: 'simulated-database-only', inserts }));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function auditTimeoutWithoutAny() {
  const originalFetch = globalThis.fetch;
  const anyDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
  const timeoutDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');
  const originalTimeout = AbortSignal.timeout;
  const caller = new AbortController();
  let usesCallerSignal = false;
  Object.defineProperty(AbortSignal, 'any', { configurable: true, value: undefined });
  Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: () => originalTimeout(5) });
  globalThis.fetch = (_url, { signal }) => {
    usesCallerSignal = signal === caller.signal;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ ok: true, status: 200, json: async () => [] }), 40);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
  };
  try {
    const scores = await getTopScores({ signal: caller.signal });
    console.log(JSON.stringify({ probe: 'timeout-without-AbortSignal-any', configuredTimeoutMs: 5,
      simulatedResponseMs: 40, usesCallerSignal, completedDespiteTimeout: Array.isArray(scores) }));
  } finally {
    caller.abort();
    globalThis.fetch = originalFetch;
    if (anyDescriptor) Object.defineProperty(AbortSignal, 'any', anyDescriptor); else delete AbortSignal.any;
    Object.defineProperty(AbortSignal, 'timeout', timeoutDescriptor);
  }
}

async function auditUncertainSave() {
  class Element {
    constructor() { this.children = []; this.value = ''; this.textContent = ''; }
    addEventListener() {}
    reset() {}
    reportValidity() { return true; }
    focus() {}
    append(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children[0]?.children ?? children; }
  }
  const originalFetch = globalThis.fetch;
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storageData = new Map();
  const elements = new Map();
  let storedOnSimulatedServer = null;
  let postAttempts = 0;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement: () => new Element(), createDocumentFragment: () => new Element(),
  } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => storageData.get(key) ?? null,
    setItem: (key, value) => storageData.set(key, value),
  } });
  // Modela una escritura ya confirmada en el servidor cuya respuesta se pierde.
  globalThis.fetch = async (_url, options = {}) => {
    if (options.method === 'POST') {
      postAttempts += 1;
      storedOnSimulatedServer = JSON.parse(options.body);
      throw new TypeError('Respuesta perdida después de guardar en el servidor simulado.');
    }
    return { ok: true, status: 200, json: async () => [] };
  };
  const board = new Leaderboard();
  try {
    board.setRunToken('audit-only-ticket');
    board.sync('over', 100, 1);
    board.nameInput.value = 'Auditoria';
    await board.submit();
    await board.submit();
    console.log(JSON.stringify({ probe: 'uncertain-save-cannot-retry',
      storedOnSimulatedServer: Boolean(storedOnSimulatedServer), postAttempts,
      savedLocally: board.savedLocally, sent: board.sent, displayedStatus: board.status.textContent }));
  } finally {
    board.destroy();
    globalThis.fetch = originalFetch;
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor); else delete globalThis.document;
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor); else delete globalThis.localStorage;
  }
}

await auditValidGameDuration();
await auditTimeoutWithoutAny();
await auditUncertainSave();
