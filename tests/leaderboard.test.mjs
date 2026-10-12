import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  createApp, createGameTicket, maximumPlausibleScore, minimumRunDurationMs,
  validateEntry, verifyGameTicket,
} from '../server.js';
import { Leaderboard, renderTopScores } from '../src/Leaderboard.js';

const valid = { name: ' José Muñoz ', score: 12345, wave: 8 };
const TEST_SECRET = 'test-secret-for-game-ticket-tests-32-bytes';

function database({ failure = false, throws = false } = {}) {
  const calls = [];
  const savedRuns = new Map();
  const row = { id: 'test-id', name: 'José Muñoz', score: 12345, wave: 8, created_at: '2026-10-12T00:00:00Z' };
  return { calls, from(table) {
    calls.push(['from', table]);
    let inserted = false;
    let insertedEntry;
    let lookupRunId = null;
    const query = {};
    for (const method of ['select', 'order', 'limit', 'single', 'maybeSingle', 'insert', 'eq']) {
      query[method] = (...args) => {
        calls.push([method, ...args]);
        if (method === 'insert') { inserted = true; insertedEntry = args[0]; }
        if (method === 'eq' && args[0] === 'run_id') lookupRunId = args[1];
        return query;
      };
    }
    query.abortSignal = async (signal) => {
      assert.ok(signal instanceof AbortSignal);
      if (throws) throw new Error('PRIVATE_SERVICE_KEY');
      if (failure) return { data: null, error: { message: 'PRIVATE_SERVICE_KEY' } };
      if (lookupRunId) return { data: savedRuns.get(lookupRunId) ?? null, error: null };
      if (inserted && savedRuns.has(insertedEntry.run_id)) return { data: null, error: { code: '23505' } };
      if (inserted) {
        const saved = { ...row, ...insertedEntry, id: 'test-id' };
        savedRuns.set(insertedEntry.run_id, saved);
        return { data: saved, error: null };
      }
      return { data: [row], error: null };
    };
    return query;
  } };
}

async function fixture(t, db = database()) {
  let now = Date.UTC(2026, 9, 12);
  const server = createApp(db, { gameSessionSecret: TEST_SECRET, now: () => now }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const url = 'http://127.0.0.1:' + server.address().port;
  const issueToken = async () => {
    const response = await fetch(url + '/api/game-session', { method: 'POST' });
    return (await response.json()).token;
  };
  return { db, url, get: (route = '/api/leaderboard') => fetch(url + route), issueToken, advance: (ms) => { now += ms; },
    post: async (body = valid, headers = { 'Content-Type': 'application/json' }) => {
      let payload = body;
      if (typeof body !== 'string') {
        const token = body.runToken ?? await issueToken();
        payload = { ...body, runToken: token };
        now += Math.max(10_000, minimumRunDurationMs(Number(payload.wave) || 1));
      }
      return fetch(url + '/api/leaderboard', {
        method: 'POST', headers, body: typeof payload === 'string' ? payload : JSON.stringify(payload),
      });
    } };
}

test('valida un único nombre Unicode, su límite e impide coerción y campos privilegiados', () => {
  assert.deepEqual(validateEntry(valid), { name: 'José Muñoz', score: 12345, wave: 8 });
  assert.deepEqual(validateEntry({ ...valid, name: 'Yordan' }), { name: 'Yordan', score: 12345, wave: 8 });
  assert.ok(validateEntry({ name: 'Yordan', score: 0, wave: 1 }));
  assert.ok(validateEntry({ ...valid, name: 'a'.repeat(30) }));
  for (const body of [null, [], {}, { ...valid, score: '12345' }, { ...valid, score: -1 },
    { ...valid, score: 1.1 }, { ...valid, score: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, wave: 0 }, { ...valid, wave: 1.2 }, { ...valid, wave: 10001 },
    { ...valid, name: '  ' }, { ...valid, name: 'a'.repeat(31) },
    { ...valid, name: '<script>' }, { ...valid, name: 'x\nY' },
    { ...valid, firstName: 'Yordan', lastName: 'Perez' },
    { ...valid, id: 'chosen' }, { ...valid, created_at: 'yesterday' }]) assert.equal(validateEntry(body), null);
  assert.ok(validateEntry({ ...valid, score: Number.MAX_SAFE_INTEGER, wave: 10000 }));
});

test('firma tickets del servidor, expira tickets antiguos y limita tiempo y puntos', () => {
  const now = Date.UTC(2026, 9, 12);
  const token = createGameTicket(TEST_SECRET, now);
  assert.ok(verifyGameTicket(token, TEST_SECRET, now + 1000));
  assert.equal(verifyGameTicket(token + 'x', TEST_SECRET, now + 1000), null);
  assert.equal(verifyGameTicket(token, 'another-secret-that-is-at-least-32-bytes', now + 1000), null);
  assert.equal(verifyGameTicket(token, TEST_SECRET, now + 6 * 60 * 60 * 1000 + 1), null);
  assert.equal(minimumRunDurationMs(8), 120_000);
  assert.ok(maximumPlausibleScore(8, 120_000) > maximumPlausibleScore(1, 0));
  assert.ok(maximumPlausibleScore(7, 60_000) >= maximumPlausibleScore(7, 0) + 20 * 4 * 15);
});

test('POST guarda un nombre libre en una sola columna', async (t) => {
  const { post, db } = await fixture(t);
  assert.equal((await post({ ...valid, name: 'Yordan Pérez' })).status, 201);
  const inserted = db.calls.find(([name]) => name === 'insert')[1];
  assert.equal(inserted.name, 'Yordan Pérez');
  assert.equal(Object.hasOwn(inserted, 'last_name'), false);
});

test('GET pide solo columnas públicas, orden estable y diez resultados', async (t) => {
  const { get, db } = await fixture(t);
  const response = await get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json())[0].score, 12345);
  assert.deepEqual(db.calls, [ ['from', 'leaderboard'], ['select', 'id, name, score, wave, created_at'],
    ['order', 'score', { ascending: false }], ['order', 'created_at', { ascending: true }],
    ['order', 'id', { ascending: true }], ['limit', 10] ]);
});

test('POST normaliza el nombre y añade el run_id privado', async (t) => {
  const { post, db } = await fixture(t);
  const response = await post();
  assert.equal(response.status, 201);
  assert.equal((await response.json()).name, 'José Muñoz');
  const inserted = db.calls.find(([name]) => name === 'insert')[1];
  assert.deepEqual({ name: inserted.name, score: inserted.score, wave: inserted.wave }, validateEntry(valid));
  assert.match(inserted.run_id, /^[0-9a-f-]{36}$/i);
});

test('al presionar Guardar, el cliente envía nombre, puntaje y oleada y el servidor los inserta', async (t) => {
  class Element {
    constructor() { this.children = []; this.listeners = {}; this.classList = { toggle() {} }; this.textContent = ''; this.value = ''; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    replaceChildren(...children) { this.children = children.length === 1 && children[0].children ? children[0].children : children; }
    append(child) { this.children.push(child); }
    reset() { this.value = ''; }
    reportValidity() { return true; }
    focus() {}
    setAttribute() {}
  }
  const elements = new Map();
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    getElementById: (id) => elements.get(id) ?? (elements.set(id, new Element()), elements.get(id)),
    createElement: () => new Element(), createDocumentFragment: () => new Element(),
  } });
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document;
    if (previousFetch) Object.defineProperty(globalThis, 'fetch', previousFetch); else delete globalThis.fetch;
  });

  const db = database();
  const { url, issueToken, advance } = await fixture(t, db);
  const nativeFetch = globalThis.fetch;
  const clientRequests = [];
  globalThis.fetch = async (input, options = {}) => {
    const target = new URL(input, url);
    clientRequests.push({ path: target.pathname, method: options.method ?? 'GET' });
    return nativeFetch(target, options);
  };

  const token = await issueToken();
  advance(minimumRunDurationMs(3));
  const board = new Leaderboard();
  board.setRunToken(token);
  board.sync('over', 2410, 3);
  board.nameInput.value = 'Yordan';
  let pendingSave;
  const submit = board.submit.bind(board);
  board.submit = () => { pendingSave = submit(); return pendingSave; };

  board.form.listeners.submit({ preventDefault() {} });
  await pendingSave;

  const inserted = db.calls.find(([method]) => method === 'insert')?.[1];
  assert.deepEqual(
    { name: inserted?.name, score: inserted?.score, wave: inserted?.wave },
    { name: 'Yordan', score: 2410, wave: 3 },
  );
  assert.match(inserted.run_id, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(clientRequests, [
    { path: '/api/game-session', method: 'POST' },
    { path: '/api/leaderboard', method: 'POST' },
    { path: '/api/leaderboard', method: 'GET' },
  ]);
  assert.equal(board.sent, true);
  assert.equal(board.rankingCard.hidden, false);
});

test('requiere ticket firmado y hace idempotente el mismo envío, rechazando cambios', async (t) => {
  const { post, issueToken, db } = await fixture(t);
  const token = await issueToken();
  assert.equal((await post({ ...valid, runToken: 'fabricated.token' })).status, 401);
  const first = await post({ ...valid, runToken: token });
  assert.equal(first.status, 201);
  assert.ok(db.calls.find(([name]) => name === 'insert')[1].run_id);
  const retry = await post({ ...valid, runToken: token });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).name, 'José Muñoz');
  assert.equal((await post({ ...valid, name: 'Otro nombre', runToken: token })).status, 409);
});

test('rechaza partidas demasiado rápidas y puntajes por encima de su cota', async (t) => {
  const { issueToken, url, advance } = await fixture(t);
  const send = (token, score, wave) => fetch(url + '/api/leaderboard', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...valid, score, wave, runToken: token }),
  });
  const tooFast = await issueToken();
  advance(minimumRunDurationMs(1) - 1);
  assert.equal((await send(tooFast, 0, 1)).status, 422);
  const fakeWaveEight = await issueToken();
  advance(5_000);
  assert.equal((await send(fakeWaveEight, 15_000, 8)).status, 422);
  const inflated = await issueToken();
  advance(minimumRunDurationMs(8));
  assert.equal((await send(inflated, Number.MAX_SAFE_INTEGER, 8)).status, 422);
});

test('rechaza entrada inválida, JSON roto, formularios y cuerpos excesivos antes de la BD', async (t) => {
  const { post, db } = await fixture(t);
  assert.equal((await post({ ...valid, score: '999' })).status, 400);
  assert.equal((await post('{broken')).status, 400);
  assert.equal((await post('a=b', { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 415);
  assert.equal((await post({ ...valid, name: 'a'.repeat(3000) })).status, 413);
  assert.equal(db.calls.length, 0);
});

test('no sirve secretos, código de servidor ni SQL; el juego sí está disponible', async (t) => {
  const { get } = await fixture(t);
  for (const route of ['/.env', '/.env.example', '/server.js', '/package.json', '/.git/config', '/node_modules/express/package.json',
    '/supabase/migrations/202610120001_leaderboard.sql', '/src/%2e%2e/server.js']) {
    assert.equal((await get(route)).status, 404, route);
  }
  assert.equal((await get('/')).status, 200);
  assert.equal((await get('/src/api.js')).status, 200);
  assert.equal((await get('/api/health')).status, 200);
});

test('la BD caída y excepciones no exponen mensajes internos', async (t) => {
  for (const db of [database({ failure: true }), database({ throws: true })]) {
    const { get, post } = await fixture(t, db);
    for (const response of [await get(), await post()]) {
      assert.equal(response.status, 503);
      assert.ok(!(await response.text()).includes('PRIVATE_SERVICE_KEY'));
    }
  }
});

test('limita escrituras a cinco por minuto e incluye Retry-After', async (t) => {
  const { post, db } = await fixture(t);
  for (let i = 0; i < 5; i++) assert.equal((await post()).status, 201);
  const response = await post();
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('retry-after')) > 0);
  assert.equal(db.calls.filter(([name]) => name === 'insert').length, 5);
});

test('reset cancela la consulta pendiente y una respuesta tardía no modifica el ranking', async (t) => {
  class Element {
    constructor() { this.children = []; this.listeners = {}; this.classList = { toggle() {} }; this.textContent = ''; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    replaceChildren(...children) { this.children = children.length === 1 && children[0].children ? children[0].children : children; }
    append(child) { this.children.push(child); }
    reset() {}
    reportValidity() { return true; }
  }
  const elements = new Map();
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    getElementById: (id) => elements.get(id) ?? (elements.set(id, new Element()), elements.get(id)),
    createElement: () => new Element(), createDocumentFragment: () => new Element(),
  } });
  let resolveFetch;
  let requestSignal;
  globalThis.fetch = (_url, { signal }) => {
    requestSignal = signal;
    return new Promise((resolve) => { resolveFetch = resolve; });
  };
  t.after(() => {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else delete globalThis.document;
    if (oldFetch) Object.defineProperty(globalThis, 'fetch', oldFetch); else delete globalThis.fetch;
  });

  const board = new Leaderboard();
  board.state = 'over';
  board.sent = true;
  const pending = board.refresh();
  assert.equal(board.status.textContent, 'Cargando ranking…');
  board.reset();
  assert.equal(requestSignal.aborted, true);
  resolveFetch({ ok: true, status: 200, json: async () => [{ name: 'Tarde Response', score: 10, wave: 1 }] });
  await pending;
  assert.equal(board.body.children.length, 0);
  assert.equal(board.status.textContent, '');
  assert.equal(board.refreshButton.disabled, false);
});

test('el formulario y Top 10 solo aparecen al perder; guardar abre el ranking y reiniciar lo oculta', async (t) => {
  class Element {
    constructor() { this.children = []; this.listeners = {}; this.classList = { toggle() {} }; this.textContent = ''; this.value = ''; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    replaceChildren(...children) { this.children = children.length === 1 && children[0].children ? children[0].children : children; }
    append(child) { this.children.push(child); }
    reset() { this.value = ''; }
    reportValidity() { return true; }
    focus() { this.focused = true; }
    setAttribute() {}
  }
  const elements = new Map();
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    getElementById: (id) => elements.get(id) ?? (elements.set(id, new Element()), elements.get(id)),
    createElement: () => new Element(), createDocumentFragment: () => new Element(),
  } });
  const requests = [];
  let finishRanking;
  globalThis.fetch = async (_url, options = {}) => {
    const method = options.method ?? 'GET';
    requests.push({ method, body: options.body ? JSON.parse(options.body) : null });
    if (method === 'POST') {
      const { name, score, wave } = JSON.parse(options.body);
      return { ok: true, status: 201, json: async () => ({ id: 'saved', name, score, wave }) };
    }
    return new Promise((resolve) => {
      finishRanking = () => resolve({ ok: true, json: async () => [
        { name: 'Ana Quispe', score: 420, wave: 3 },
      ] });
    });
  };
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document;
    if (previousFetch) Object.defineProperty(globalThis, 'fetch', previousFetch); else delete globalThis.fetch;
  });

  let restarts = 0;
  const board = new Leaderboard({ onRestart: () => { restarts += 1; } });
  assert.equal(board.form.hidden, true);
  assert.equal(board.resultPanel.hidden, true);
  assert.equal(board.panel.hidden, true);
  board.sync('ready', 0, 1);
  board.sync('playing', 100, 1);
  board.sync('paused', 100, 1);
  assert.equal(board.form.hidden, true);
  assert.equal(board.panel.hidden, true);
  await board.refresh();
  await board.submit();
  assert.equal(requests.length, 0);

  board.setRunToken('signed-test-ticket');
  board.sync('over', 420, 3);
  assert.equal(board.resultPanel.hidden, false);
  assert.equal(board.finalScore.textContent, '420');
  assert.equal(board.finalWave.textContent, '03');
  assert.equal(board.form.hidden, false);
  assert.equal(board.panel.hidden, true);
  assert.equal(board.entryCard.hidden, false);
  assert.equal(board.rankingCard.hidden, true);
  assert.equal(requests.length, 0);
  elements.get('playerName').value = 'Ana Quispe';

  const pendingSave = board.submit();
  await new Promise(setImmediate);
  // El formulario ya está cerrado aunque el GET del ranking aún no responda.
  assert.equal(board.entryCard.hidden, true);
  assert.equal(board.form.hidden, true);
  assert.equal(board.resultPanel.hidden, true);
  assert.equal(board.rankingCard.hidden, false);
  finishRanking();
  await pendingSave;
  assert.deepEqual(requests.map(({ method }) => method), ['POST', 'GET']);
  assert.deepEqual(requests[0].body, { name: 'Ana Quispe', score: 420, wave: 3, runToken: 'signed-test-ticket' });
  assert.equal(board.panel.hidden, false);
  assert.equal(board.entryCard.hidden, true);
  assert.equal(board.rankingCard.hidden, false);
  assert.equal(board.body.children[0].children[1].textContent, 'Ana Quispe');

  board.restartButton.listeners.click();
  assert.equal(restarts, 1);
  assert.equal(board.form.hidden, true);
  assert.equal(board.resultPanel.hidden, true);
  assert.equal(board.panel.hidden, true);
  assert.equal(board.rankingCard.hidden, true);
  assert.equal(board.body.children.length, 0);
  // Un nombre compuesto viaja como un único campo.
  board.setRunToken('second-test-ticket');
  board.sync('over', 100, 1);
  board.nameInput.value = 'Yordan';
  const singleNameSave = board.submit();
  await new Promise(setImmediate);
  assert.equal(requests.at(-2).body.name, 'Yordan');
  assert.equal(board.entryCard.hidden, true);
  finishRanking();
  await singleNameSave;
  board.reset();
});

test('si falla el envío global, conserva el puntaje en el ranking local y libera el formulario', async (t) => {
  class Element {
    constructor() { this.children = []; this.listeners = {}; this.textContent = ''; this.value = ''; this.disabled = false; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    replaceChildren(...children) { this.children = children.length === 1 && children[0].children ? children[0].children : children; }
    append(child) { this.children.push(child); }
    reset() { this.value = ''; }
    reportValidity() { return true; }
    focus() {}
    setAttribute() {}
  }
  const elements = new Map();
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    getElementById: (id) => elements.get(id) ?? (elements.set(id, new Element()), elements.get(id)),
    createElement: () => new Element(), createDocumentFragment: () => new Element(),
  } });
  let postAttempts = 0;
  const storageData = new Map();
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => storageData.get(key) ?? null,
    setItem: (key, value) => storageData.set(key, value),
  } });
  globalThis.fetch = async (_url, options = {}) => {
    if (options.method === 'POST') {
      postAttempts += 1;
      return { ok: false, status: 422, json: async () => ({ error: 'La duración no es suficiente.' }) };
    }
    return { ok: true, status: 200, json: async () => [] };
  };
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document;
    if (previousFetch) Object.defineProperty(globalThis, 'fetch', previousFetch); else delete globalThis.fetch;
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage); else delete globalThis.localStorage;
  });

  const board = new Leaderboard();
  board.setRunToken('signed-test-ticket');
  board.sync('over', 150, 2);
  board.nameInput.value = 'Yordan';
  await board.submit();
  assert.equal(postAttempts, 1);
  assert.equal(board.sent, true);
  assert.equal(board.savedLocally, true);
  assert.equal(board.entryCard.hidden, true);
  assert.equal(board.rankingCard.hidden, false);
  assert.equal(board.nameInput.disabled, true);
  assert.equal(board.button.textContent, 'GUARDADO ✓');
  assert.equal(board.title.textContent, 'TOP 10 LOCAL');
  assert.match(board.status.textContent, /Guardado en este dispositivo/);
  const localScores = JSON.parse(storageData.get('cuy-invaders-local-leaderboard-v1'));
  assert.ok(localScores.some((entry) => entry.name === 'Yordan' && entry.score === 150 && entry.wave === 2));
  board.reset();
});

test('permite guardar localmente aunque el backend no entregue un ticket de sesión', async (t) => {
  class Element {
    constructor() { this.children = []; this.listeners = {}; this.textContent = ''; this.value = ''; this.disabled = false; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    replaceChildren(...children) { this.children = children.length === 1 && children[0].children ? children[0].children : children; }
    append(child) { this.children.push(child); }
    reset() { this.value = ''; }
    reportValidity() { return true; }
    focus() {}
  }
  const elements = new Map();
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    getElementById: (id) => elements.get(id) ?? (elements.set(id, new Element()), elements.get(id)),
    createElement: () => new Element(), createDocumentFragment: () => new Element(),
  } });
  globalThis.fetch = async () => { assert.fail('No debe intentar publicar sin ticket de sesión.'); };
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document;
    if (previousFetch) Object.defineProperty(globalThis, 'fetch', previousFetch); else delete globalThis.fetch;
  });

  const board = new Leaderboard();
  board.setRunToken(null, 'No se pudo validar la partida para el ranking global.');
  board.sync('over', 2170, 3);
  board.nameInput.value = 'Yordan';
  assert.equal(board.button.disabled, false);
  await board.submit();
  assert.equal(board.sent, true);
  assert.equal(board.savedLocally, true);
  assert.equal(board.rankingCard.hidden, false);
  assert.match(board.status.textContent, /Guardado/);
  board.reset();
});

test('el límite de nombre solo avisa al intentar excederlo y permite reemplazar texto seleccionado', (t) => {
  class Element {
    constructor() { this.value = ''; this.textContent = ''; this.listeners = {}; this.selectionStart = 0; this.selectionEnd = 0; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    replaceChildren() {}
    reset() {}
  }
  const elements = new Map();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    getElementById: (id) => elements.get(id) ?? (elements.set(id, new Element()), elements.get(id)),
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  const board = new Leaderboard();
  const input = board.nameInput;
  assert.equal(input.maxLength, 30);
  input.value = 'a'.repeat(30);
  input.selectionStart = input.selectionEnd = 30;
  input.listeners.input({ isComposing: false });
  assert.equal(board.nameLimit.hidden, true);
  input.listeners.keydown({ key: 'ArrowLeft' });
  input.listeners.keydown({ key: 'c', ctrlKey: true });
  assert.equal(board.nameLimit.hidden, true);
  let blocked = false;
  input.listeners.keydown({ key: 'b', preventDefault() { blocked = true; } });
  assert.equal(blocked, true);
  assert.equal(board.nameLimit.hidden, false);
  input.selectionStart = 0;
  input.selectionEnd = 5;
  input.listeners.keydown({ key: 'b', preventDefault() { assert.fail('Debe permitir reemplazar la selección.'); } });
  input.value = 'b' + 'a'.repeat(25);
  input.listeners.input({ isComposing: false });
  assert.equal(board.nameLimit.hidden, true);
  input.value = 'a'.repeat(30);
  input.selectionStart = input.selectionEnd = 30;
  input.listeners.beforeinput({ inputType: 'insertText', data: null, cancelable: true, preventDefault() { blocked = true; } });
  assert.equal(board.nameLimit.hidden, false);
  input.value = 'Ana ';
  input.selectionStart = input.selectionEnd = 4;
  input.listeners.paste({ clipboardData: { getData: () => 'b'.repeat(40) } });
  input.value = 'Ana ' + 'b'.repeat(26);
  input.listeners.input({ isComposing: false });
  assert.equal(board.nameLimit.hidden, false);
  input.value = 'a'.repeat(35);
  input.listeners.input({ isComposing: false });
  assert.equal(input.value.length, 30);
  board.reset();
  assert.equal(board.nameLimit.hidden, true);
});

test('Top 3, puestos normales y nombres maliciosos se pintan como texto', (t) => {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.textContent = ''; }
    append(child) { this.children.push(child); }
    replaceChildren(fragment) { this.children = fragment.children; }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: (tag) => new Element(tag), createDocumentFragment: () => new Element('fragment'),
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  const body = new Element('tbody');
  const scores = Array.from({ length: 12 }, () => ({ name: '<img src=x onerror=alert(1)>', score: 100, wave: 8 }));
  renderTopScores(body, scores);
  assert.equal(body.children.length, 10);
  assert.deepEqual(body.children.slice(0, 4).map((row) => row.className), ['rank-1', 'rank-2', 'rank-3', 'rank-standard']);
  assert.equal(body.children[0].children[0].textContent, '👑 1');
  assert.equal(body.children[0].children[1].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(body.children[0].children[1].children.length, 0);
  renderTopScores(body, [{ name: 'Yordan', score: 100, wave: 7 }]);
  assert.equal(body.children[0].children[1].textContent, 'Yordan');
  renderTopScores(body, []);
  assert.equal(body.children.length, 0);
});
