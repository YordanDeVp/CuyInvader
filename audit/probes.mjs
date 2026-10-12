// Diagnóstico local: no usa credenciales ni escribe en Supabase o Render.
import { once } from 'node:events';
import { createApp, minimumRunDurationMs } from '../server.js';
import { Game } from '../src/Game.js';
import { Enemy } from '../src/entities/Enemy.js';
import { Leaderboard } from '../src/Leaderboard.js';

function auditShortCanvas() {
  const results = [];
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    matchMedia: () => ({ matches: true }),
  } });
  try {
    for (const wave of [1, 3, 4, 7]) {
      const game = Object.create(Game.prototype);
      game.canvas = { width: 600, height: 144, focus() {} };
      game.assets = {};
      game.ui = { announcement: { textContent: '' }, 'orientation-overlay': { hidden: true } };
      game.input = { clear() {}, isDown: () => false, direction: 0 };
      game.syncHUD = game.syncUI = game.beginGameSession = () => {};
      game.reset();
      game.wave = wave - 1;
      game.spawnWave();
      game.player.invulnerability = Infinity; // Aísla la derrota por invasión.
      game.updateOrientation();
      const lowestEnemy = Math.max(...game.enemies.map(enemy => enemy.y + enemy.height));
      game.update(1 / 120);
      results.push({ wave, lowestEnemy, playerTop: game.player.hitbox.y, state: game.state,
        orientationBlocked: game.orientationBlocked, orientationOverlay: !game.ui['orientation-overlay'].hidden });
    }
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else delete globalThis.window;
  }
  console.log(JSON.stringify({ probe: 'short-canvas-landscape-guard', canvas: [600, 144], results }));
}

async function auditApi() {
  let now = Date.UTC(2026, 9, 12);
  let databaseAvailable = true;
  const rows = [];
  const db = { from() {
    let entry;
    let lookupRunId;
    const query = {};
    for (const method of ['select', 'order', 'limit', 'single', 'maybeSingle', 'eq']) {
      query[method] = (...args) => { if (method === 'eq' && args[0] === 'run_id') lookupRunId = args[1]; return query; };
    }
    query.insert = value => { entry = value; return query; };
    query.abortSignal = async () => {
      if (!databaseAvailable) return { data: null, error: { code: 'TEST_DB_DOWN' } };
      if (lookupRunId) return { data: rows.find(row => row.run_id === lookupRunId) ?? null, error: null };
      if (!entry) return { data: rows, error: null };
      if (rows.some(row => row.run_id === entry.run_id)) return { data: null, error: { code: '23505' } };
      const row = { id: 'audit-row', name: entry.name, score: entry.score, wave: entry.wave,
        run_id: entry.run_id, created_at: new Date(now).toISOString() };
      rows.push(row);
      return { data: row, error: null };
    };
    return query;
  } };
  const server = createApp(db, { gameSessionSecret: 'local-audit-secret-not-used-in-production-32', now: () => now }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port;
  try {
    const quickSession = await fetch(url + '/api/game-session', { method: 'POST' });
    const { token: quickToken } = await quickSession.json();
    now += 5_000;
    const quick = await fetch(url + '/api/leaderboard', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Audit', score: 15000, wave: 8, runToken: quickToken }),
    });
    const delayedSession = await fetch(url + '/api/game-session', { method: 'POST' });
    const { token: delayedToken } = await delayedSession.json();
    now += minimumRunDurationMs(8);
    // Sigue siendo posible falsificar datos tras esperar: un ticket temporal no prueba la simulación.
    const delayed = await fetch(url + '/api/leaderboard', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Audit', score: 15000, wave: 8, runToken: delayedToken }),
    });
    console.log(JSON.stringify({ probe: 'unplayed-score', claimedWave: 8, claimedScore: 15000,
      quickElapsedMs: 5000, quickStatus: quick.status, minimumRunMs: minimumRunDurationMs(8),
      delayedStatus: delayed.status, stored: rows.length === 1 }));
    let accepted = 2;
    let lastStatus;
    for (let i = 0; i < 20; i += 1) {
      const response = await fetch(url + '/api/game-session', { method: 'POST' });
      if (response.status === 201) accepted += 1;
      lastStatus = response.status;
    }
    console.log(JSON.stringify({ probe: 'shared-ip-sessions', accepted, nextStatus: lastStatus }));
    databaseAvailable = false;
    const health = await fetch(url + '/api/health');
    const ranking = await fetch(url + '/api/leaderboard');
    console.log(JSON.stringify({ probe: 'database-down', healthStatus: health.status, rankingStatus: ranking.status }));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

function auditMissileArea() {
  for (const pattern of ['grid', 'triangle']) {
    const game = Object.create(Game.prototype);
    game.canvas = { width: 1200, height: 800, focus() {} };
    game.assets = {};
    game.ui = { announcement: { textContent: '' } };
    game.input = { clear() {}, isDown: () => false, direction: 0 };
    game.syncHUD = game.syncUI = game.beginGameSession = () => {};
    game.reset(); game.wave = 7; game.spawnWave();
    const slots = Enemy.slotsForFormation(pattern, game.layout);
    game.enemies.forEach(enemy => {
      if (!enemy.isBoss) enemy.setSlot(slots[enemy.index], true);
      enemy.update(0, game.formation);
    });
    const troops = game.enemies.filter(enemy => !enemy.isBoss);
    const middleY = game.formation.y + game.layout.top + game.layout.height / 2;
    const distance = enemy => Math.abs(enemy.x + enemy.width / 2 - 600) + Math.abs(enemy.y + enemy.height / 2 - middleY);
    const impact = [...troops].sort((a, b) => distance(a) - distance(b))[0];
    game.player.collectPower('missile'); game.activatePowerUp('missile');
    const missile = game.projectiles.at(-1);
    const area = { x: impact.x + impact.width / 2 - missile.blastWidth / 2,
      y: impact.y + impact.height / 2 - missile.blastHeight / 2,
      width: missile.blastWidth, height: missile.blastHeight };
    const affected = troops.filter(enemy => Game.overlaps(area, enemy));
    console.log(JSON.stringify({ probe: 'missile-area', pattern, blastHeight: missile.blastHeight,
      affectedEnemies: affected.length, affectedRows: new Set(affected.map(enemy => enemy.y.toFixed(3))).size }));
  }
}

async function auditSaveRecovery() {
  class Element {
    constructor() { this.value = ''; this.textContent = ''; this.children = []; }
    addEventListener() {}
    reset() {}
    reportValidity() { return true; }
    focus() {}
    append(value) { this.children.push(value); }
    replaceChildren(...values) { this.children = values; }
  }
  const elements = new Map();
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldFetch = globalThis.fetch;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    getElementById: id => elements.get(id) ?? (elements.set(id, new Element()), elements.get(id)),
    createElement: () => new Element(), createDocumentFragment: () => new Element(),
  } });
  let posts = 0;
  const requests = [];
  globalThis.fetch = async (_url, options = {}) => {
    requests.push(options.method ?? 'GET');
    if (options.method !== 'POST') return { ok: true, status: 200, json: async () => [] };
    if (++posts === 1) throw new Error('Respuesta perdida después de guardar.');
    const { name, score, wave } = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ id: 'saved-before-network-drop', name, score, wave }) };
  };
  const board = new Leaderboard();
  try {
    board.setRunToken('local-test-ticket');
    board.sync('over', 100, 1);
    board.nameInput.value = 'Audit';
    await board.submit();
    await board.submit();
    console.log(JSON.stringify({ probe: 'lost-save-response-recovery', requests, sent: board.sent,
      entryVisible: !board.entryCard.hidden, rankingVisible: !board.rankingCard.hidden, button: board.button.textContent }));
  } finally {
    board.destroy();
    globalThis.fetch = oldFetch;
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
    else delete globalThis.document;
  }
}

auditShortCanvas();
auditMissileArea();
await auditApi();
await auditSaveRecovery();
