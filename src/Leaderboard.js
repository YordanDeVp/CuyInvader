import { getTopScores, submitScore } from './api.js';

const NAME_MAX_LENGTH = 30;

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
    this.controller = new AbortController();
    this.generation = 0;
    this.refreshGeneration = 0;
    this.loading = false;
    this.runToken = null;
    this.runSessionError = null;
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
    this.refreshController = null;
    this.loading = false;
    this.refreshButton.disabled = false;
    this.refreshButton.hidden = true;
    this.runToken = null;
    this.runSessionError = null;
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
  }

  sync(state, score, wave, reason = '') {
    this.entryCard.hidden = state !== 'over' || this.sent;
    this.rankingCard.hidden = state !== 'over' || !this.sent;
    this.form.hidden = state !== 'over' || this.sent;
    this.resultPanel.hidden = state !== 'over' || this.sent;
    this.panel.hidden = state !== 'over' || !this.sent;
    if (state === 'over' && this.state !== 'over') {
      this.result = { score, wave, runToken: this.runToken }; // Captura el ticket de esa partida.
      this.finalScore.textContent = Number(score).toLocaleString('es-PE');
      this.finalWave.textContent = String(wave).padStart(2, '0');
      this.reason.textContent = reason;
      this.button.disabled = !this.runToken;
      this.message.textContent = this.runSessionError || (this.runToken ? '' : 'Validando la sesión de la partida…');
      this.nameInput.focus({ preventScroll: true });
    }
    this.state = state;
  }

  setRunToken(token, error = null) {
    this.runToken = typeof token === 'string' ? token : null;
    this.runSessionError = error;
    if (!this.result || this.state !== 'over') return;
    this.result.runToken = this.runToken;
    this.button.disabled = !this.runToken || this.sending || this.sent;
    this.message.textContent = error || (this.runToken ? '' : 'Validando la sesión de la partida…');
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
      renderTopScores(this.body, scores);
      this.status.textContent = scores.length ? '' : 'Todavía no hay puntajes.';
    } catch (error) {
      if (controller.signal.aborted || generation !== this.refreshGeneration) return;
      this.body.replaceChildren();
      this.status.textContent = error.message;
      this.refreshButton.hidden = false;
    } finally {
      if (generation === this.refreshGeneration) {
        this.loading = false;
        this.refreshController = null;
        this.refreshButton.disabled = false;
      }
    }
  }

  async submit() {
    if (this.state !== 'over' || !this.result?.runToken || this.sending || this.sent || !this.form.reportValidity()) return;
    const name = this.nameInput.value.slice(0, NAME_MAX_LENGTH).trim().normalize('NFC');
    if (!name) {
      this.message.textContent = 'Ingresa un nombre.';
      this.nameInput.focus({ preventScroll: true });
      return;
    }
    const generation = this.generation;
    this.sending = true;
    this.button.disabled = true;
    this.nameInput.disabled = true;
    this.button.textContent = 'GUARDANDO…';
    this.message.textContent = 'Guardando…';
    try {
      await submitScore({ ...this.result,
        name });
      if (generation !== this.generation) return;
      this.sent = true;
      this.button.textContent = 'GUARDADO ✓';
      this.message.textContent = '¡Puntaje guardado!';
      this.status.textContent = 'Puntaje guardado. Cargando el Top 10…';
      this.entryCard.hidden = true;
      this.form.hidden = true;
      this.resultPanel.hidden = true;
      this.rankingCard.hidden = false;
      this.panel.hidden = false;
      document.getElementById('leaderboard-title').focus?.({ preventScroll: true });
      await this.refresh();
    } catch (error) {
      if (generation === this.generation) this.message.textContent = error.message;
    } finally {
      if (generation === this.generation) {
        this.sending = false;
        this.nameInput.disabled = this.sent;
        this.button.disabled = this.sent || !this.runToken;
        this.button.textContent = this.sent ? 'GUARDADO ✓' : 'GUARDAR';
      }
    }
  }

  destroy() { this.generation += 1; this.controller.abort(); }
}
