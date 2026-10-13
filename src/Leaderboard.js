import { getTopScores, submitScore } from './api.js';

const NAME_MAX_LENGTH = 30;
const LOCAL_SCORES_KEY = 'cuy-invaders-local-leaderboard-v1';
const LOCAL_SCORE_LIMIT = 100;
let sessionScores = [];

function readLocalScores() {
  let persisted = [];
  try {
    const raw = globalThis.localStorage?.getItem(LOCAL_SCORES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      persisted = parsed.filter((entry) => entry && typeof entry.name === 'string' &&
        Number.isSafeInteger(entry.score) && entry.score >= 0 &&
        Number.isInteger(entry.wave) && entry.wave > 0 && typeof entry.id === 'string');
    }
  } catch {
    // Algunos navegadores bloquean localStorage; la copia de esta sesión sigue disponible.
  }
  const unique = new Map();
  for (const entry of [...persisted, ...sessionScores]) unique.set(entry.id, entry);
  return [...unique.values()].sort((a, b) => b.score - a.score || b.wave - a.wave ||
    String(a.created_at).localeCompare(String(b.created_at))).slice(0, LOCAL_SCORE_LIMIT);
}

function saveLocalScore({ name, score, wave }) {
  if (typeof name !== 'string' || !name.trim() || name.length > NAME_MAX_LENGTH ||
      !Number.isSafeInteger(score) || score < 0 || !Number.isInteger(wave) || wave < 1) {
    throw new Error('El puntaje no tiene un formato válido para guardarlo.');
  }
  const entry = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: name.trim().normalize('NFC'), score, wave, created_at: new Date().toISOString(),
  };
  sessionScores.push(entry);
  const scores = readLocalScores();
  sessionScores = scores.slice(0, LOCAL_SCORE_LIMIT);
  let persistent = false;
  try {
    globalThis.localStorage?.setItem(LOCAL_SCORES_KEY, JSON.stringify(scores));
    persistent = Boolean(globalThis.localStorage);
  } catch {
    // El registro queda en memoria hasta que la página se cierre.
  }
  return { entry, scores: scores.slice(0, 10), persistent };
}

export function renderTopScores(tbody, scores) {
  const fragment = document.createDocumentFragment();
  scores.slice(0, 10).forEach((entry, index) => {
    const row = document.createElement('tr');
    row.className = index < 3 ? 'rank-' + (index + 1) : 'rank-standard';
    const rank = [ '👑 1', '🥈 2', '🥉 3' ][index] || String(index + 1);
    const name = entry.name ?? '';
    for (const value of [rank, name, Number(entry.score).toLocaleString('es-PE'), entry.wave]) {
      const cell = document.createElement('td');
      // Los nombres son datos, nunca HTML ejecutable.
      cell.textContent = String(value);
      row.append(cell);
    }
    fragment.append(row);
  });
  tbody.replaceChildren(fragment);
}

export class Leaderboard {
  constructor({ onRestart } = {}) {
    this.onRestart = onRestart;
    this.form = document.getElementById('leaderboard-form');
    this.nameInput = document.getElementById('playerName');
    this.nameLimit = document.getElementById('playerName-limit');
    this.nameInput.maxLength = NAME_MAX_LENGTH;
    this.entryCard = document.getElementById('gameover-card');
    this.rankingCard = document.getElementById('leaderboard-card');
    this.panel = document.getElementById('leaderboard-panel');
    this.resultPanel = document.getElementById('leaderboard-result');
    this.reason = document.getElementById('gameover-reason');
    this.finalScore = document.getElementById('final-score');
    this.finalWave = document.getElementById('final-wave');
    this.body = document.getElementById('leaderboard-rows');
    this.status = document.getElementById('leaderboard-status');
    this.message = document.getElementById('leaderboard-submit-status');
    this.button = document.getElementById('leaderboard-submit');
    this.refreshButton = document.getElementById('leaderboard-refresh');
    this.restartButton = document.getElementById('leaderboard-restart');
    this.title = document.getElementById('leaderboard-title');
    this.controller = new AbortController();
    this.generation = 0;
    this.refreshGeneration = 0;
    this.loading = false;
    this.runToken = null;
    this.savedLocally = false;
    const options = { signal: this.controller.signal };
    // maxlength bloquea el exceso; el aviso solo responde a un intento real.
    this.nameInput.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || [...event.key].length !== 1) return;
      if (this.nameWouldOverflow(event.key)) {
        event.preventDefault();
        this.showNameLimit();
      }
    }, options);
    this.nameInput.addEventListener('beforeinput', (event) => {
      if (event.isComposing || !event.inputType?.startsWith('insert')) return;
      const text = event.data ?? event.dataTransfer?.getData('text/plain');
      if (text === '') return;
      if (typeof text === 'string' && this.nameWouldOverflow(text)) {
        this.nameLimitPending = true;
        this.showNameLimit();
      }
      // También cubre teclados móviles que no emiten keydown ni event.data.
      if (this.nameWouldOverflow('x')) {
        if (event.cancelable) event.preventDefault();
        this.nameLimitPending = true;
        this.showNameLimit();
      }
    }, options);
    this.nameInput.addEventListener('paste', (event) => {
      const text = event.clipboardData?.getData('text/plain');
      if (typeof text === 'string' && this.nameWouldOverflow(text)) {
        this.nameLimitPending = true;
        this.showNameLimit();
      }
    }, options);
    this.nameInput.addEventListener('input', (event) => {
      if (!event.isComposing) this.syncNameInput();
    }, options);
    this.nameInput.addEventListener('compositionend', () => this.syncNameInput(), options);
    this.form.addEventListener('submit', (event) => { event.preventDefault(); void this.submit(); }, options);
    this.refreshButton.addEventListener('click', () => void this.refresh(), options);
    this.restartButton.addEventListener('click', () => { this.reset(); this.onRestart?.(); }, options);
    this.reset();
  }

  nameWouldOverflow(text) {
    const selected = (this.nameInput.selectionEnd ?? 0) - (this.nameInput.selectionStart ?? 0);
    return this.nameInput.value.length - selected + text.length > NAME_MAX_LENGTH;
  }

  showNameLimit() {
    this.nameLimit.textContent = 'Límite de 30 caracteres.';
    this.nameLimit.hidden = false;
  }

  syncNameInput() {
    const overflow = this.nameInput.value.length > NAME_MAX_LENGTH;
    if (overflow) {
      // Evita dejar medio carácter Unicode al recortar un pegado o un IME.
      this.nameInput.value = this.nameInput.value.slice(0, NAME_MAX_LENGTH).replace(/[\uD800-\uDBFF]$/, '');
      this.showNameLimit();
    } else if (this.nameInput.value.length < NAME_MAX_LENGTH || !this.nameLimitPending) {
      this.nameLimit.hidden = true;
    }
    this.nameLimitPending = false;
  }

  reset() {
    // Las respuestas de una partida vieja no cambian el formulario de la nueva.
    this.generation += 1;
    this.refreshGeneration += 1;
    this.refreshController?.abort();
    this.submitController?.abort();
    clearTimeout(this.retryTimer);
    this.retryAt = 0;
    this.pendingPayload = null;
    this.runReplay = null;
    this.refreshController = null;
    this.loading = false;
    this.refreshButton.disabled = false;
    this.refreshButton.hidden = true;
    this.runToken = null;
    this.savedLocally = false;
    this.result = null;
    this.state = null;
    this.sending = false;
    this.sent = false;
    this.form.reset();
    this.nameLimit.hidden = true;
    this.nameLimit.textContent = '';
    this.nameLimitPending = false;
    this.entryCard.hidden = true;
    this.rankingCard.hidden = true;
    this.form.hidden = true;
    this.resultPanel.hidden = true;
    this.body.replaceChildren();
    this.status.textContent = '';
    this.button.disabled = false;
    this.button.textContent = 'GUARDAR';
    this.nameInput.disabled = false;
    this.message.textContent = '';
    this.panel.hidden = true;
    this.title.textContent = 'TOP 10 GLOBAL';
  }

  sync(state, score, wave, reason = '') {
    this.entryCard.hidden = state !== 'over' || this.sent;
    this.rankingCard.hidden = state !== 'over' || !this.sent;
    this.form.hidden = state !== 'over' || this.sent;
    this.resultPanel.hidden = state !== 'over' || this.sent;
    this.panel.hidden = state !== 'over' || !this.sent;
    if (state === 'over' && this.state !== 'over') {
      this.result = { score, wave, runToken: this.runToken, replay: this.runReplay };
      this.finalScore.textContent = Number(score).toLocaleString('es-PE');
      this.finalWave.textContent = String(wave).padStart(2, '0');
      this.reason.textContent = reason;
      this.button.disabled = false;
      this.message.textContent = '';
      this.nameInput.focus({ preventScroll: true });
    }
    this.state = state;
  }

  setRunToken(token) {
    this.runToken = typeof token === 'string' ? token : null;
    if (!this.result || this.state !== 'over') return;
    this.result.runToken = this.runToken;
    this.button.disabled = this.sending || this.sent;
  }

  async refresh() {
    if (this.state !== 'over' || !this.sent) return;
    if (this.loading) return;
    const controller = new AbortController();
    this.refreshController = controller;
    const generation = ++this.refreshGeneration;
    this.loading = true;
    this.refreshButton.disabled = true;
    this.refreshButton.hidden = true;
    this.status.textContent = 'Cargando ranking…';
    try {
      const scores = await getTopScores({ signal: controller.signal });
      if (controller.signal.aborted || generation !== this.refreshGeneration) return;
      this.title.textContent = 'TOP 10 GLOBAL';
      renderTopScores(this.body, scores);
      this.status.textContent = scores.length ? '' : 'Todavía no hay puntajes.';
    } catch (error) {
      if (controller.signal.aborted || generation !== this.refreshGeneration) return;
      const localScores = readLocalScores();
      if (localScores.length) {
        this.title.textContent = 'TOP 10 LOCAL';
        renderTopScores(this.body, localScores);
        this.status.textContent = 'No se pudo conectar al ranking global. Se muestran puntajes guardados en este dispositivo.';
      } else {
        this.body.replaceChildren();
        this.status.textContent = error.message;
      }
      this.refreshButton.hidden = false;
    } finally {
      if (generation === this.refreshGeneration) {
        this.loading = false;
        this.refreshController = null;
        this.refreshButton.disabled = false;
      }
    }
  }

  setReplay(replay) { this.runReplay = replay; }

  async submit() {
    if (this.state !== 'over' || !this.result || this.sending || this.sent || !this.form.reportValidity()) return;
    if (Date.now() < this.retryAt) { this.message.textContent = 'Espera unos segundos antes de reintentar.'; return; }
    const name = this.pendingPayload?.name ?? this.nameInput.value.slice(0, NAME_MAX_LENGTH).trim().normalize('NFC');
    if (!name) {
      this.message.textContent = 'Ingresa un nombre.';
      this.nameInput.focus({ preventScroll: true });
      return;
    }
    const generation = this.generation;
    const controller = new AbortController();
    this.submitController = controller;
    this.sending = true;
    this.button.disabled = true;
    this.nameInput.disabled = true;
    this.button.textContent = 'GUARDANDO…';
    this.message.textContent = 'Guardando…';
    try {
      if (!this.result.runToken) {
        // Sin sesión desde el inicio, este resultado solo pertenece al dispositivo.
        const local = saveLocalScore({ name, score: this.result.score, wave: this.result.wave });
        this.savedLocally = true;
        this.sent = true;
        this.title.textContent = 'TOP 10 LOCAL';
        renderTopScores(this.body, local.scores);
        this.status.textContent = local.persistent
          ? 'Partida sin conexión guardada en este dispositivo.'
          : 'Guardado temporalmente en esta sesión; el navegador bloqueó el almacenamiento local.';
        this.openRanking();
        return;
      }

      // Un POST incierto se reintenta con exactamente el mismo ticket y nombre.
      this.pendingPayload ??= { ...this.result, name };
      this.nameInput.value = this.pendingPayload.name;
      await submitScore(this.pendingPayload, { signal: controller.signal });
      if (generation !== this.generation || controller.signal.aborted) return;

      this.sent = true;
      this.savedLocally = false;
      this.button.textContent = 'GUARDADO ✓';
      this.message.textContent = '¡Puntaje guardado!';
      this.status.textContent = 'Puntaje guardado. Cargando el Top 10…';
      this.openRanking();
      await this.refresh();
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return;
      const uncertain = !error.status || error.status >= 500 || error.status === 429 || (error.status >= 200 && error.status < 300);
      if (uncertain && !this.savedLocally) {
        saveLocalScore({ name, score: this.result.score, wave: this.result.wave });
        this.savedLocally = true;
      }
      // Un rechazo previo a la escritura permite corregir el nombre. Una
      // respuesta perdida conserva el payload original para evitar duplicados.
      if ([400, 422].includes(error.status)) this.pendingPayload = null;
      // La copia local no confirma el envío global. Solo HTTP 200/201 cierra
      // el formulario; un error restaura los controles para confirmar el POST.
      this.message.textContent = error.message;
      if (uncertain) this.message.textContent += ' Hay una copia local; el envío global sigue pendiente.';
      if (error.retryAfterMs) {
        this.retryAt = Date.now() + error.retryAfterMs;
        this.retryTimer = setTimeout(() => {
          if (generation === this.generation && !this.sent) { this.button.disabled = false; this.button.textContent = 'GUARDAR'; }
        }, error.retryAfterMs);
      }
    } finally {
      if (generation === this.generation) {
        this.sending = false;
        this.nameInput.disabled = this.sent;
        this.button.disabled = this.sent || Date.now() < this.retryAt;
        this.button.textContent = this.sent ? 'GUARDADO ✓' : 'GUARDAR';
      }
    }
  }

  openRanking() {
    this.entryCard.hidden = true;
    this.form.hidden = true;
    this.resultPanel.hidden = true;
    this.rankingCard.hidden = false;
    this.panel.hidden = false;
    this.title.focus?.({ preventScroll: true });
  }

  destroy() { this.reset(); this.controller.abort(); }
}
