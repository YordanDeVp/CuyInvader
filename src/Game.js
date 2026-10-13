import { InputHandler } from './InputHandler.js';
import { AudioManager } from './AudioManager.js';
import { Leaderboard } from './Leaderboard.js';
import { startGameSession } from './api.js';
import { RunRecorder, seededRandom, sessionParameters } from './RunReplay.js';
import { laserIntervalForWave, minionsPerSummonForWave, impostorCountForWave,
  LASER_BURST_WAVE, EXTREME_WAVE } from './GameRules.js';
import { Player } from './entities/Player.js';
import { Enemy, Minion } from './entities/Enemy.js';

const FORMATIONS = ['grid', 'triangle', 'crescent'];
const NAMES = { grid: 'BLOQUE', triangle: 'TRIÁNGULO', crescent: 'SEMILUNA' };
const FORMATION_INTERVAL = 7;

export const GameState = Object.freeze({ READY: 'ready', PLAYING: 'playing', PAUSED: 'paused', GAME_OVER: 'over', UPGRADE_MENU: 'upgrade_menu' });

// Recortes de la hoja adjunta (2752 × 1536), sin los rótulos decorativos.
const FRAMES = {
  pilot: [87, 136, 137, 225], projectile: [91, 520, 131, 206],
  chavin: [46, 890, 214, 224], moche: [50, 1270, 208, 226],
  jalapeno: [1808, 520, 161, 204],
};

class Sprite {
  draw(ctx, x, y, width, height) {
    if (!this.source) return false;
    ctx.drawImage(this.source, x, y, width, height);
    return true;
  }

  load(sheet, [x, y, width, height]) {
    const surface = document.createElement('canvas');
    surface.width = width;
    surface.height = height;
    const ctx = surface.getContext('2d');
    const sx = sheet.naturalWidth / 2752;
    const sy = sheet.naturalHeight / 1536;
    ctx.drawImage(sheet, x * sx, y * sy, width * sx, height * sy, 0, 0, width, height);
    // El JPG tiene fondo negro: quitamos solo el negro conectado al borde.
    // Se conservan pupilas y detalles oscuros encerrados dentro del personaje.
    const pixels = ctx.getImageData(0, 0, width, height);
    const queue = new Int32Array(width * height);
    const visited = new Uint8Array(width * height);
    let head = 0;
    let tail = 0;
    const add = (index) => {
      if (visited[index]) return;
      visited[index] = 1;
      const i = index * 4;
      if (Math.max(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]) > 42) return;
      pixels.data[i + 3] = 0;
      queue[tail++] = index;
    };
    for (let col = 0; col < width; col += 1) { add(col); add((height - 1) * width + col); }
    for (let row = 0; row < height; row += 1) { add(row * width); add(row * width + width - 1); }
    while (head < tail) {
      const index = queue[head++];
      if (index % width > 0) add(index - 1);
      if (index % width < width - 1) add(index + 1);
      if (index >= width) add(index - width);
      if (index < width * (height - 1)) add(index + width);
    }
    ctx.putImageData(pixels, 0, 0);
    this.source = surface;
  }
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) throw new Error('No se pudo iniciar Canvas 2D.');
    const ids = ['score', 'wave', 'speed', 'health', 'formation', 'formation-time', 'laser-time',
      'bosses', 'boss-phase', 'fullscreen', 'pause', 'status', 'overlay', 'overlay-kicker',
      'overlay-title', 'overlay-message', 'overlay-hint', 'play', 'restart', 'pause-restart', 'announcement',
      'start-card', 'gameover-card', 'gameover-restart', 'leaderboard-card', 'leaderboard-restart', 'gameover-reason',
      'jalapeno-slot', 'missile-slot', 'jalapeno-count', 'missile-count', 'jalapeno-active', 'sound',
      'drop-progress', 'drop-time', 'touch-jalapeno', 'touch-missile', 'touch-jalapeno-count', 'touch-missile-count',
      'reveal', 'damage-upgrade', 'speed-upgrade', 'upgrade-modal'];
    this.ui = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
    this.ui['orientation-overlay'] = document.getElementById('orientation-overlay');
    this.assets = this.loadAssets();
    this.audio = new AudioManager();
    // Tolera un index.html anterior que aún esté en caché al desplegar.
    this.leaderboard = document.getElementById('leaderboard-form') ? new Leaderboard({ onRestart: () => this.restart() }) : null;
    this.input = new InputHandler((code) => this.handleAction(code));
    this.controller = new AbortController();
    const options = { signal: this.controller.signal };
    this.ui.play.addEventListener('click', () => this.state === GameState.UPGRADE_MENU ? this.applyUpgrade('speed') : this.play(), options);
    this.ui['damage-upgrade']?.addEventListener('click', () => this.applyUpgrade('damage'), options);
    this.ui['speed-upgrade']?.addEventListener('click', () => this.applyUpgrade('speed'), options);
    // El diálogo conserva el foco entre sus dos tarjetas al navegar con Tab.
    this.ui['upgrade-modal']?.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      event.preventDefault();
      const speed = this.ui['speed-upgrade'];
      (document.activeElement === speed ? this.ui['damage-upgrade'] : speed)?.focus();
    }, options);
    this.ui.pause.addEventListener('click', () => this.togglePause(), options);
    this.ui.restart.addEventListener('click', () => this.restart(), options);
    this.ui['pause-restart']?.addEventListener('click', () => this.restart(), options);
    this.ui['gameover-restart']?.addEventListener('click', () => this.restart(), options);
    this.ui.fullscreen.addEventListener('click', () => this.toggleFullscreen(), options);
    this.ui['jalapeno-slot']?.addEventListener('click', () => this.activatePowerUp('jalapeno'), options);
    this.ui['missile-slot']?.addEventListener('click', () => this.activatePowerUp('missile'), options);
    this.ui.sound?.addEventListener('click', () => {
      this.audio.toggleMute();
      this.syncHUD();
    }, options);
    // Capture desbloquea el audio antes del click de Jugar o del control táctil.
    document.querySelector('.arcade').addEventListener('pointerdown', () => this.audio.unlock(), { ...options, capture: true });
    document.querySelector('.arcade').addEventListener('keydown', () => this.audio.unlock(), { ...options, capture: true });
    window.addEventListener('resize', () => this.resize(), options);
    window.addEventListener('orientationchange', () => this.updateOrientation(), options);
    window.visualViewport?.addEventListener('resize', () => this.resize(), options);
    window.addEventListener('blur', () => this.pause(), options);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    }, options);
    document.addEventListener('fullscreenchange', () => {
      this.ui.fullscreen.textContent = document.fullscreenElement ? 'SALIR ⤡' : 'AMPLIAR ⤢';
      this.ui.fullscreen.setAttribute('aria-label', document.fullscreenElement ? 'Salir de pantalla completa' : 'Ampliar a pantalla completa');
      this.resize();
      this.syncUI();
    }, options);
    this.resize();
    this.reset('ready');
    this.updateOrientation();
  }

  loadAssets() {
    const assets = Object.fromEntries(Object.keys(FRAMES).map((key) => [key, new Sprite()]));
    const sheet = new Image();
    sheet.onload = () => {
      for (const [key, frame] of Object.entries(FRAMES)) assets[key].load(sheet, frame);
    };
    // Si falta la hoja, cada entidad conserva su dibujo geométrico.
    sheet.onerror = () => { sheet.onerror = null; };
    sheet.src = new URL('../assets/sprites-andinos.jpg', import.meta.url).href;
    return assets;
  }

  // Cambiamos las coordenadas reales del mundo; no estiramos un canvas horizontal.
  resize() {
    this.updateOrientation();
    const compact = window.matchMedia('(max-width: 768px)').matches;
    const mobile = compact || window.matchMedia('(pointer: coarse) and (orientation: portrait)').matches;
    const width = mobile ? 600 : 1200;
    const visibleHeight = window.visualViewport?.height ?? window.innerHeight;
    // Reserva espacio real para HUD, etiqueta y gamepad que ahora vive bajo el canvas.
    const viewWidth = window.visualViewport?.width ?? window.innerWidth;
    const reservedUI = ['.masthead', '.hud', '.battlebar', '.touch-controls', '.screen-label', '.controls']
      .reduce((sum, selector) => sum + document.querySelector(selector).getBoundingClientRect().height, 24);
    // En el layout compacto Flexbox decide el área libre. El mundo usa esa misma
    // proporción para llenar el canvas sin estirar sprites ni sus hitboxes.
    const screen = document.querySelector('.screen').getBoundingClientRect();
    const height = compact ? Math.max(320, Math.min(1400, Math.round(screen.height / Math.max(1, screen.width) * width)))
      : mobile ? Math.round(Math.max(420, Math.min(1200, (visibleHeight - reservedUI) / Math.max(1, viewWidth) * 600))) : 800;
    this.resizeWorld(width, height);
  }

  // También lo usa el servidor al reproducir cambios de tamaño de la partida.
  resizeWorld(width, height) {
    const oldWidth = this.canvas.width;
    const oldHeight = this.canvas.height;
    if (oldWidth === width && oldHeight === height && this.layout) { this.syncUI(); return; }
    this.canvas.width = width;
    this.canvas.height = height;
    if (this.ctx) this.ctx.imageSmoothingEnabled = false;
    // Los botones ya tienen su franja DOM; reservarla de nuevo dentro del
    // canvas adelantaba el límite de derrota hasta 155 px en móviles.
    this.bottomSpace = 28;
    if (!this.player) return;
    if (['playing', 'paused', 'upgrade_menu'].includes(this.state)) this.recorder?.event('r', width, height);
    if (this.recorder) this.recorder.lastInput = '';
    this.pause();
    const oldBottom = this.layout.top + this.layout.height + this.layout.size / 2;
    const descentProgress = Math.max(0, (this.formation.y - this.layout.startY) /
      Math.max(1, this.player.y - oldBottom - this.layout.startY));
    this.player.x *= width / oldWidth;
    this.player.resize(width, height, this.bottomSpace);
    this.layout = Enemy.layout(this.wave, width, height, this.player.y, this.layout.count);
    this.formation.halfWidth = this.layout.span / 2;
    this.formation.x = Math.max(12 + this.formation.halfWidth, Math.min(width - 12 - this.formation.halfWidth, this.formation.x * width / oldWidth));
    const newBottom = this.layout.top + this.layout.height + this.layout.size / 2;
    this.formation.y = this.layout.startY + descentProgress * Math.max(1, this.player.y - newBottom - this.layout.startY);
    const slots = Enemy.slotsForFormation(FORMATIONS[this.formationIndex], this.layout);
    this.enemies.forEach((enemy) => {
      enemy.resize(this.layout);
      enemy.setSlot(enemy.isBoss ? Enemy.bossSlot(enemy.index, this.layout) : slots[enemy.index], true);
      enemy.update(0, this.formation);
    });
    this.minions.forEach((minion) => minion.resize(this.layout));
    this.explosions = [];
    for (const entity of [...this.projectiles, ...this.enemyProjectiles, ...this.powerUps, ...this.particles, ...this.minions]) {
      entity.x *= width / oldWidth;
      entity.y *= height / oldHeight;
    }
    this.syncUI();
  }

  reset(state = 'playing', token = undefined) {
    this.sessionController?.abort();
    this.leaderboard?.reset();
    this.runGeneration = (this.runGeneration ?? 0) + 1;
    this.sessionToken = token ?? null;
    this.leaderboard?.setRunToken(this.sessionToken);
    this.random = token ? seededRandom(sessionParameters(token).seed) : Math.random;
    this.recorder = token ? new RunRecorder(this.canvas.width, this.canvas.height) : null;
    this.state = state;
    this.score = 0;
    this.wave = 0;
    this.projectiles = [];
    this.enemyProjectiles = [];
    this.particles = [];
    this.explosions = [];
    this.powerUps = [];
    this.minions = [];
    this.dropElapsed = 0;
    this.dropInterval = null; // Se activa al entrar por primera vez en oleada 8.
    this.guardiansDefeated = 0;
    this.upgradeOfferedWave = 0;
    this.pendingWave = null;
    this.formationIndex = 0;
    this.formationElapsed = 0;
    this.laserElapsed = 0;
    this.damageFlash = 0;
    this.revealTime = 0;
    this.bossNotice = '';
    this.defeatReason = '';
    this.input.clear();
    this.player = new Player(this.canvas.width, this.canvas.height, null, this.assets.projectile, this.assets.pilot);
    this.player.resize(this.canvas.width, this.canvas.height, this.bottomSpace);
    this.spawnWave();
    if (state === GameState.PLAYING && token === undefined) this.beginGameSession(this.runGeneration);
  }

  beginGameSession(generation) {
    const controller = new AbortController();
    this.sessionController = controller;
    this.state = 'starting';
    this.syncUI();
    // La física empieza después de recibir la semilla firmada. La latencia de
    // Render ya no acorta artificialmente el tiempo de una partida legítima.
    void startGameSession({ signal: controller.signal }).then((token) => {
      if (generation !== this.runGeneration) return;
      sessionParameters(token);
      this.reset('playing', token);
      if (this.orientationBlocked || document.hidden) this.pause();
      this.syncUI();
      if (this.state === 'playing') this.canvas.focus({ preventScroll: true });
    }).catch((error) => {
      if (generation !== this.runGeneration) return;
      if (typeof window !== 'undefined') {
        console.error('[Cuy Invaders] No se pudo crear la sesión de partida:', error);
      }
      this.reset('playing', null);
      if (this.orientationBlocked || document.hidden) this.pause();
      // La validación solo protege el ranking global. El formulario sigue
      // habilitado y guarda en el navegador si el servicio de sesión falla.
      this.leaderboard?.setRunToken(null);
      this.syncUI();
      if (this.state === 'playing') this.canvas.focus({ preventScroll: true });
    });
  }

  spawnWave() {
    this.wave += 1;
    this.enemySpeed = Enemy.speedForWave(this.wave);
    this.layout = Enemy.layout(this.wave, this.canvas.width, this.canvas.height, this.player.y);
    this.formation = { x: this.canvas.width / 2, y: this.layout.startY, direction: this.wave % 2 ? 1 : -1, halfWidth: this.layout.span / 2, descentElapsed: 0 };
    if (this.wave >= 8 && this.dropInterval === null) this.dropInterval = this.randomDropInterval();
    this.enemies = Enemy.slotsForFormation(FORMATIONS[this.formationIndex], this.layout).map((slot, index) => {
      const type = index % 2 ? 'moche' : 'chavin';
      return new Enemy(slot, type, this.assets[type], index, this.wave, this.layout);
    });
    const impostors = this.randomBossIndices(impostorCountForWave(this.wave));
    const burstBosses = this.randomBossIndices(this.wave >= LASER_BURST_WAVE ? 2 : 0);
    for (let index = 0; index < this.layout.bosses; index += 1) {
      const boss = new Enemy(Enemy.bossSlot(index, this.layout), 'boss', this.assets.chavin, index, this.wave, this.layout, impostors.has(index));
      boss.hasLaserBurst = burstBosses.has(index);
      this.enemies.push(boss);
    }
    this.enemies.forEach((enemy) => enemy.update(0, this.formation));
    this.laserElapsed = 0;
    this.enemyProjectiles = [];
    this.minions = [];
    this.revealTime = 0;
    this.syncUI();
    this.announce('Oleada ' + this.wave + '. ' + this.layout.count + ' tropas y ' + this.layout.bosses + ' guardianes.');
  }

  randomBossIndices(amount) {
    // Muestreo sin reemplazo: evita seleccionar dos veces el mismo jefe.
    const pool = Array.from({ length: this.layout.bosses }, (_, index) => index);
    const selected = new Set();
    const random = this.random ?? Math.random;
    while (selected.size < amount && pool.length) {
      selected.add(pool.splice(Math.floor(random() * pool.length), 1)[0]);
    }
    return selected;
  }

  announce(message) { this.ui.announcement.textContent = message; }

  handleAction(code) {
    if (this.orientationBlocked) return;
    this.audio?.unlock();
    if (code === 'KeyQ') this.activatePowerUp('jalapeno');
    else if (code === 'KeyE') this.activatePowerUp('missile');
    // El botón táctil Fuego envía Space: tras perder no debe reiniciar la partida.
    else if (code === 'Enter' && ['ready', 'over'].includes(this.state)) this.play();
    else if (code === 'Space' && this.state === 'ready') this.play();
    else if (['KeyP', 'Escape', 'Enter'].includes(code)) this.togglePause();
    else if (code === 'KeyR') this.restart();
  }

  play() {
    if (this.orientationBlocked) return;
    if (this.state === 'over') { this.reset(); return; }
    else if (this.state === 'ready') {
      this.runGeneration += 1;
      this.sessionToken = null;
      this.leaderboard?.setRunToken(null);
      this.beginGameSession(this.runGeneration);
      return;
    }
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.syncUI();
    this.canvas.focus({ preventScroll: true });
  }

  restart() {
    if (this.orientationBlocked) return;
    this.reset();
    this.canvas.focus({ preventScroll: true });
  }

  applyUpgrade(kind) {
    if (this.orientationBlocked || this.state !== GameState.UPGRADE_MENU || !this.pendingWave) return;
    if (kind === 'speed') this.player.upgradeSpeed();
    else if (kind === 'damage') this.player.projectileDamage += 1;
    else return;
    this.recorder?.event('u', kind === 'speed' ? 0 : 1);
    this.upgradeOfferedWave = this.pendingWave;
    this.pendingWave = null;
    this.state = 'playing';
    this.spawnWave();
    this.canvas.focus({ preventScroll: true });
  }

  pause() {
    this.input.clear();
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.syncUI();
  }

  updateOrientation() {
    const landscapeMobile = window.matchMedia(
      '(orientation: landscape) and (max-width: 900px), (orientation: landscape) and (pointer: coarse)',
    ).matches;
    this.orientationBlocked = landscapeMobile;
    if (this.ui?.['orientation-overlay']) this.ui['orientation-overlay'].hidden = !landscapeMobile;
    if (landscapeMobile) {
      this.input?.clear();
      if (this.state === GameState.PLAYING) this.pause();
    }
  }

  togglePause() {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.play();
  }

  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.querySelector('.arcade').requestFullscreen();
    } catch { this.announce('La pantalla completa no está disponible en este navegador.'); }
  }

  activatePowerUp(kind) {
    if (this.state !== 'playing') return;
    // No se gastan cargas al pulsar Q mientras el jalapeño sigue activo.
    if (kind === 'jalapeno' && this.player.powerTime > 0) return;
    if (!this.player.consumePower(kind)) return;
    this.recorder?.event('p', kind === 'jalapeno' ? 0 : 1);
    if (kind === 'missile') {
      // La huella física se usa para jefes/secuaces. Las tropas se seleccionan
      // por sus celdas lógicas actuales, incluso mientras cambian de forma.
      const pitchX = (this.layout.span - this.layout.size) / Math.max(1, this.layout.columns - 1);
      const rows = Math.ceil(this.layout.count * (this.formationIndex === 1 ? 2 : 1) / this.layout.columns);
      const pitchY = this.layout.height / Math.max(1, rows - 1);
      this.projectiles.push(this.player.shootMissile(pitchX * 3, pitchY * 3));
      this.announce('¡Choclo misil lanzado! Explosión de área 3 por 3.');
    } else {
      this.player.activatePower();
      this.announce('¡Jalapeño activado! Ocho segundos de choclos triples en llamas.');
    }
    this.audio?.powerupUseSound();
    this.audio?.playPowerUpJingle();
    this.syncHUD();
  }

  randomDropInterval() { return 10 + (this.random ?? Math.random)() * 5; }

  spawnPowerUp(kind, centerX, y, bubble = true) {
    this.powerUps.push({ kind, bubble, x: Math.max(0, Math.min(this.canvas.width - 44, centerX - 22)), y, width: 44, height: 52 });
  }

  updateEndgameDrops(dt) {
    if (this.state !== 'playing' || this.wave < 8 || this.dropInterval === null) return;
    // Reloj global desde la oleada 8: persiste al cambiar de oleada y solo
    // acumula deltaTime de juego activo (nunca pausa ni menú de mejoras).
    this.dropElapsed += dt;
    while (this.dropElapsed + 1e-9 >= this.dropInterval) {
      this.dropElapsed = Math.max(0, this.dropElapsed - this.dropInterval);
      const random = this.random ?? Math.random;
      const kind = random() < 0.5 ? 'jalapeno' : 'missile';
      this.spawnPowerUp(kind, 30 + random() * (this.canvas.width - 60), -52);
      this.dropInterval = this.randomDropInterval();
    }
  }

  updateFormation(dt) {
    this.formationElapsed += dt;
    while (this.formationElapsed + 1e-9 >= FORMATION_INTERVAL) {
      this.formationElapsed = Math.max(0, this.formationElapsed - FORMATION_INTERVAL);
      this.formationIndex = (this.formationIndex + 1) % FORMATIONS.length;
      const name = FORMATIONS[this.formationIndex];
      const slots = Enemy.slotsForFormation(name, this.layout);
      this.enemies.forEach((enemy) => { if (!enemy.isBoss) enemy.setSlot(slots[enemy.index]); });
      this.announce('Nueva formación: ' + NAMES[name] + '.');
    }
    Enemy.advanceFormation(this.formation, this.enemySpeed * (this.layout.mobile ? 0.7 : 1), dt, this.canvas.width);
    this.enemies.forEach((enemy) => enemy.update(dt, this.formation));
  }

  updateLasers(dt) {
    if (!this.enemies.some((enemy) => enemy.isBoss)) return;
    // Procesar antes de la salva evita consumir el retraso en el frame inicial.
    this.enemies.forEach((enemy) => this.enemyProjectiles.push(...enemy.updateLaserBurst(dt)));
    const interval = laserIntervalForWave(this.wave);
    this.laserElapsed += dt;
    if (this.laserElapsed + 1e-9 >= interval - 1) this.enemies.forEach((enemy) => enemy.prepareLaser(this.player));
    if (this.laserElapsed + 1e-9 >= interval) {
      this.laserElapsed = Math.max(0, this.laserElapsed - interval);
      this.enemies.forEach((enemy) => this.enemyProjectiles.push(...enemy.fireLasers()));
    }
  }

  updateMinionAttacks(dt) {
    if (this.wave < EXTREME_WAVE) return;
    const active = this.minions.filter((minion) => minion.alive);
    if (!active.length) return;
    const lastY = Math.max(...active.map((minion) => minion.y + minion.height / 2));
    for (const minion of active) {
      if (minion.y + minion.height >= this.player.hitbox.y) continue;
      // La fila más baja se recalcula al morir o moverse los secuaces; los de atrás no disparan.
      const isLastRow = lastY - (minion.y + minion.height / 2) <= Math.min(12, minion.height / 3);
      const blade = minion.fireBlade(dt, isLastRow, this.player, this.random ?? Math.random);
      if (blade) this.enemyProjectiles.push(blade);
    }
  }

  updateSummons() {
    for (const boss of this.enemies) {
      const minionCount = minionsPerSummonForWave(this.wave);
      let spawnIndices;
      if (boss.isImpostor) {
        // Un reloj aleatorio propio por impostor; usa la semilla del replay.
        const index = boss.consumeImpostorSummon(minionCount, this.random ?? Math.random);
        if (index === null) continue;
        spawnIndices = [index];
      } else {
        if (!boss.consumeSummon()) continue;
        spawnIndices = Array.from({ length: minionCount }, (_, index) => index);
      }
      for (const index of spawnIndices) {
        const minion = new Minion(0, boss.y + boss.height + 18, this.assets.moche, this.wave, this.layout);
        const center = boss.x + boss.width / 2 + (index - (minionCount - 1) / 2) * (minion.width + 10);
        minion.x = Math.max(8, Math.min(this.canvas.width - minion.width - 8, center - minion.width / 2));
        // Nacen delante del jefe, con un margen para que el cuy pueda reaccionar.
        minion.y = Math.min(minion.y, this.player.hitbox.y - minion.height - 90);
        this.minions.push(minion);
      }
      this.bossNotice = spawnIndices.length === 1 ? '¡EL IMPOSTOR INVOCA UN SECUAZ!' :
        '¡EL JEFE INVOCA ' + minionCount + ' SECUACES!';
      this.revealTime = 3;
      this.announce(this.bossNotice);
    }
  }

  hitPlayer() {
    if (!this.player.takeHit()) return;
    this.damageFlash = 0.2;
    this.burst(this.player, '#ff547d');
    this.announce('Impacto. Resistencia: ' + this.player.health + ' de 3.');
  }

  endGame(reason) {
    this.defeatReason = reason;
    this.state = 'over';
    this.input.clear();
    this.leaderboard?.setReplay(this.recorder?.export() ?? null);
    this.syncUI();
  }

  static overlaps(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }

  defeatEnemy(enemy) {
    this.score += enemy.points;
    this.burst(enemy);
    this.audio?.explosionSound();
    if (!enemy.isBoss) return;
    this.guardiansDefeated += 1;
    // El contador persiste entre oleadas; la primera fase del impostor no suma.
    if (this.guardiansDefeated % 5 === 0) {
      this.spawnPowerUp('jalapeno', enemy.x + enemy.width / 2, enemy.y);
      this.announce('¡Jalapeño! Atrápalo y guárdalo para activar con Q.');
    }
  }

  updatePowerUps(dt) {
    this.powerUps = this.powerUps.filter((item) => {
      item.y += 125 * dt;
      if (Game.overlaps(item, this.player.hitbox)) {
        const stored = this.player.collectPower(item.kind);
        // Inventario lleno: el drop se recoge igualmente y otorga 100 puntos.
        if (!stored) this.score += 100;
        this.audio?.powerupCollectSound();
        this.announce(stored
          ? (item.kind === 'missile' ? 'Choclo misil guardado. Pulsa E.' : 'Jalapeño guardado. Pulsa Q.')
          : 'Poder al máximo: +100 puntos.');
        return false;
      }
      return item.y <= this.canvas.height;
    });
  }

  damageEnemy(enemy, damage) {
    if (!enemy.alive) return;
    const result = enemy.takeHit(damage);
    if (result === 'defeated') this.defeatEnemy(enemy);
    if (result === 'reveal') {
      this.revealTime = 3;
      this.bossNotice = '¡IMPOSTOR REVELADO! DERROTA SU VERDADERA FORMA';
      this.burst(enemy, '#d63222');
      this.announce('¡Impostor revelado! Su verdadera forma tiene una nueva barra de vida.');
      this.syncAudio();
    }
  }

  detonateMissile(projectile, impact, targets) {
    const isTroop = (enemy) => !enemy.isBoss && enemy.type !== 'minion';
    const anchor = isTroop(impact) ? impact : targets.filter(enemy => enemy.alive && isTroop(enemy)).sort((a, b) =>
      Math.hypot(a.x - impact.x, a.y - impact.y) - Math.hypot(b.x - impact.x, b.y - impact.y))[0];
    const area = {
      x: impact.x + impact.width / 2 - projectile.blastWidth / 2,
      y: impact.y + impact.height / 2 - projectile.blastHeight / 2,
      width: projectile.blastWidth, height: projectile.blastHeight,
    };
    // AABB contra un área de 3×3 celdas. Cada enemigo recibe daño una vez;
    // se reutilizan puntuación, drops y la segunda fase del impostor.
    for (const target of targets) {
      // Como máximo tres vecinos por fila y tres filas. La semiluna no puede
      // multiplicar el daño al comprimir sus coordenadas verticales.
      const inArea = isTroop(target)
        ? anchor && Math.abs(target.cellRow - anchor.cellRow) <= 1 && Math.abs(target.cellColumn - anchor.cellColumn) <= 1
        : Game.overlaps(area, target);
      if (target.alive && inArea) this.damageEnemy(target, projectile.damage);
    }
    this.explosions.push({ ...area, life: 0.35 });
  }

  update(dt) {
    if (this.state !== 'playing') return;
    this.recorder?.step(this.input);
    this.damageFlash = Math.max(0, this.damageFlash - dt);
    this.revealTime = Math.max(0, this.revealTime - dt);
    this.player.update(dt, this.input, this.canvas.width);
    if (this.input.isDown('Space')) {
      const shots = this.player.shoot();
      this.projectiles.push(...shots);
      if (shots.length) this.audio?.shootSound();
    }
    this.projectiles.forEach((p) => p.update(dt, this.canvas.width, this.canvas.height));
    this.updateFormation(dt);
    this.minions.forEach((minion) => minion.update(dt, this.player, this.canvas.width, this.canvas.height));
    const targets = [...this.enemies, ...this.minions];
    for (const projectile of this.projectiles) {
      if (!projectile.active) continue;
      for (const enemy of targets) {
        if (!enemy.alive || !Game.overlaps(projectile, enemy)) continue;
        projectile.active = false;
        if (projectile.isMissile) this.detonateMissile(projectile, enemy, targets);
        else this.damageEnemy(enemy, projectile.damage);
        break;
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.active);
    this.enemies = this.enemies.filter((enemy) => enemy.alive);
    this.syncAudio();
    // Se resuelven primero los impactos: un jefe derrotado no puede invocar.
    this.updateSummons();
    this.updateLasers(dt);
    this.updateMinionAttacks(dt);
    for (const laser of this.enemyProjectiles) {
      laser.update(dt, this.canvas.width, this.canvas.height);
      if (laser.active && Game.overlaps(laser, this.player.hitbox)) {
        laser.active = false;
        this.hitPlayer();
      }
    }
    this.enemyProjectiles = this.enemyProjectiles.filter((p) => p.active);
    for (const minion of this.minions) {
      if (minion.alive && Game.overlaps(minion, this.player.hitbox)) {
        minion.alive = false;
        this.burst(minion, '#d63222');
        this.hitPlayer();
      }
    }
    this.minions = this.minions.filter((minion) => minion.alive);
    this.updateEndgameDrops(dt);
    this.updatePowerUps(dt);
    this.explosions.forEach((explosion) => { explosion.life -= dt; });
    this.explosions = this.explosions.filter((explosion) => explosion.life > 0);
    this.particles.forEach((p) => { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; });
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.player.health <= 0) { this.endGame('Tu ametralladora se quedó sin resistencia.'); return; }
    if (this.enemies.some((enemy) => enemy.y + enemy.height >= this.player.hitbox.y)) {
      this.endGame('Las reliquias llegaron al valle.');
      return;
    }
    if (!this.enemies.length && !this.minions.length) {
      this.projectiles = [];
      const nextWave = this.wave + 1;
      // Ofrece una mejora justo antes de oleadas donde sube la vida de la tropa.
      if (nextWave >= 4 && (nextWave - 1) % 3 === 0 && this.upgradeOfferedWave !== nextWave) {
        this.pendingWave = nextWave;
        this.state = GameState.UPGRADE_MENU;
        this.syncUI();
        return;
      }
      this.spawnWave();
    }
    this.syncHUD();
  }

  burst(entity, color = '#f1ba62') {
    for (let i = 0; i < 8; i += 1) {
      const angle = i * Math.PI / 4;
      this.particles.push({ x: entity.x + entity.width / 2, y: entity.y + entity.height / 2,
        vx: Math.cos(angle) * 100, vy: Math.sin(angle) * 100, life: 0.28, color });
    }
  }

  syncHUD() {
    const bosses = this.enemies.filter((enemy) => enemy.isBoss).length;
    const values = {
      score: String(this.score).padStart(6, '0'), wave: String(this.wave).padStart(2, '0'),
      speed: (this.enemySpeed / 64).toFixed(2) + '×',
      health: '♥'.repeat(this.player.health) + '·'.repeat(3 - this.player.health),
      formation: NAMES[FORMATIONS[this.formationIndex]],
      'formation-time': Math.ceil(FORMATION_INTERVAL - this.formationElapsed) + 's',
      'laser-time': bosses ? (this.laserElapsed >= laserIntervalForWave(this.wave) - 1 ? '¡ESQUIVA!' : Math.ceil(laserIntervalForWave(this.wave) - this.laserElapsed) + 's') : '—',
      bosses: this.layout.bosses ? bosses + '/' + this.layout.bosses : 'DESDE N.3',
      'boss-phase': this.minions.length ? this.minions.length + ' SECUACES' : this.enemies.some((enemy) => enemy.isTrueForm) ? 'IMPOSTOR' : '',
      'jalapeno-count': this.player.jalapenoCount + '/3',
      'missile-count': this.player.chocloMisilCount + '/3',
      'touch-jalapeno-count': String(this.player.jalapenoCount),
      'touch-missile-count': String(this.player.chocloMisilCount),
      'jalapeno-active': this.player.powerTime > 0 ? Math.ceil(this.player.powerTime) + 's FUEGO' : 'Q / CTRL',
      'drop-progress': this.guardiansDefeated % 5 + '/5 GUARDIANES',
      'drop-time': this.wave >= 8 ? Math.ceil(this.dropInterval - this.dropElapsed) + 's' : 'DESDE N.8',
    };
    for (const [key, value] of Object.entries(values)) if (this.ui[key] && this.ui[key].textContent !== value) this.ui[key].textContent = value;
    for (const [kind, slot, touch, label] of [
      ['jalapeno', 'jalapeno-slot', 'touch-jalapeno', 'Jalapeño, teclas Q o Control'],
      ['missile', 'missile-slot', 'touch-missile', 'Choclo misil, teclas E o Shift'],
    ]) {
      const count = this.player.powerCount(kind);
      const active = kind === 'jalapeno' && this.player.powerTime > 0;
      for (const id of [slot, touch]) {
        const button = this.ui[id];
        if (!button) continue;
        button.disabled = this.state !== 'playing' || count === 0 || active;
        button.setAttribute('aria-label', label + ', ' + count + ' de 3 cargas' + (active ? ', activo' : ''));
        button.classList.toggle('loaded', count > 0);
        button.classList.toggle('active', active);
      }
    }
    if (this.ui.sound) {
      this.ui.sound.textContent = this.audio.muted ? 'SONIDO OFF' : 'SONIDO ON';
      this.ui.sound.setAttribute('aria-pressed', String(!this.audio.muted));
      this.ui.sound.setAttribute('aria-label', this.audio.muted ? 'Activar sonido' : 'Silenciar sonido');
    }
    this.ui.reveal.hidden = this.revealTime <= 0 || this.state !== 'playing';
    if (this.ui.reveal.textContent !== this.bossNotice) this.ui.reveal.textContent = this.bossNotice;
    this.ui.health.setAttribute('aria-label', 'Resistencia: ' + this.player.health + ' de 3');
  }

  syncUI() {
    this.syncHUD();
    this.syncAudio();
    this.ui.status.textContent = { ready: 'EN ESPERA', starting: 'CONECTANDO', playing: 'EN EL VALLE', paused: 'EN PAUSA', over: 'FIN DE PARTIDA', [GameState.UPGRADE_MENU]: 'MEJORA' }[this.state];
    this.ui.play.disabled = this.state === 'starting';
    this.ui.pause.disabled = !['playing', 'paused'].includes(this.state);
    this.ui.pause.textContent = this.state === 'paused' ? '▶' : 'Ⅱ';
    this.ui.pause.setAttribute('aria-label', this.state === 'paused' ? 'Reanudar partida' : 'Pausar partida');
    this.ui.overlay.hidden = this.state === 'playing';
    if (this.ui['start-card']) this.ui['start-card'].hidden = this.state === GameState.GAME_OVER;
    if (this.ui.play) this.ui.play.hidden = this.state === GameState.GAME_OVER;
    if (this.ui['pause-restart']) this.ui['pause-restart'].hidden = this.state !== 'paused' || !window.matchMedia('(max-width: 768px)').matches;
    const upgradeModal = this.ui['upgrade-modal'];
    if (upgradeModal) {
      const opening = upgradeModal.hidden && this.state === GameState.UPGRADE_MENU;
      upgradeModal.hidden = this.state !== GameState.UPGRADE_MENU;
      if (opening) this.ui['speed-upgrade']?.focus({ preventScroll: true });
    }
    if (this.ui['damage-upgrade']) this.ui['damage-upgrade'].hidden = this.state !== GameState.UPGRADE_MENU;
    const copy = {
      starting: ['PREPARANDO PARTIDA', 'Un momento…', 'Conectando con el ranking.', 'CONECTANDO', ''],
      ready: ['UN CUY. UNA AMETRALLADORA.', 'Defiende\nlos Andes.', 'Espacio dispara. Q o Ctrl activa jalapeño; E o Shift lanza el choclo misil 3×3. Guarda hasta 3 cargas de cada poder. Desde la oleada 8 caen burbujas.', 'JUGAR', 'FLECHAS / A D · ESPACIO · Q / CTRL · E / SHIFT'],
      paused: ['TOMA UN RESPIRO.', 'Valle en pausa.', 'Tu cuy te espera. Continúa cuando estés listo.', 'CONTINUAR', 'O PRESIONA P / ENTER'],
      over: [this.defeatReason.toUpperCase(), '¡Buen intento!', 'Guarda tu resultado y vuelve a defender los Andes cuando quieras.', 'JUGAR DE NUEVO', 'O PRESIONA ENTER'],
      [GameState.UPGRADE_MENU]: ['DESCANSO ENTRE OLEADAS', '¡Mejora tu equipo!', 'La oleada ' + this.pendingWave + ' tendrá más resistencia. Elige una mejora para continuar.', '+ VELOCIDAD (+20 %)', 'ELIGE UNA MEJORA PARA SEGUIR'],
    }[this.state];
    if (copy) {
      this.ui['overlay-kicker'].textContent = copy[0];
      this.ui['overlay-title'].textContent = copy[1];
      this.ui['overlay-message'].textContent = copy[2];
      this.ui.play.textContent = copy[3] + ' ↗';
      this.ui['overlay-hint'].textContent = copy[4];
      if (this.state === GameState.UPGRADE_MENU) this.ui['damage-upgrade'].hidden = false;
    }
    this.leaderboard?.sync(this.state, this.score, this.wave, this.defeatReason);
  }

  drawBackground() {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    ctx.fillStyle = '#0c151c';
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 100; i += 1) {
      ctx.fillStyle = i % 4 === 0 ? '#63847e' : '#2f484e';
      ctx.fillRect((i * 137 + 31) % width, (i * 83 + 17) % (height - 90), 2, 2);
    }
    for (let layer = 0; layer < 2; layer += 1) {
      ctx.fillStyle = layer ? '#1c3538' : '#172a30';
      for (let x = 0; x < width; x += 16) {
        const peak = Math.abs(((x + layer * 110) % 320) - 160);
        const top = height * 0.65 + layer * 70 + Math.floor(peak * 0.65 / 16) * 16;
        ctx.fillRect(x, top, 16, height - top);
      }
    }
    ctx.fillStyle = '#476761';
    ctx.fillRect(12, this.player.y + this.player.height + 12, width - 24, 1);
  }

  drawJalapeno(ctx, x, y, width, height) {
    if (this.assets.jalapeno.draw(ctx, x, y, width, height)) return;
    ctx.fillStyle = '#ed422c';
    ctx.fillRect(x + width * 0.3, y + height * 0.2, width * 0.6, height * 0.55);
    ctx.fillRect(x, y + height * 0.65, width * 0.65, height * 0.25);
    ctx.fillStyle = '#77c65e';
    ctx.fillRect(x + width * 0.65, y, width * 0.15, height * 0.3);
  }

  drawPowerIcon(ctx, kind, x, y, width, height) {
    if (kind !== 'missile') { this.drawJalapeno(ctx, x, y, width, height); return; }
    if (this.assets.projectile.draw(ctx, x, y, width, height)) return;
    ctx.fillStyle = '#f5cd69';
    ctx.fillRect(x + width * 0.2, y, width * 0.6, height * 0.8);
    ctx.fillStyle = '#fff0ad';
    ctx.fillRect(x + width * 0.4, y + 2, width * 0.2, height * 0.7);
    ctx.fillStyle = '#81dec3';
    ctx.fillRect(x, y + height * 0.7, width, height * 0.3);
  }

  drawPowerUp(ctx, item) {
    ctx.save();
    if (item.bubble) {
      ctx.fillStyle = '#81dec316';
      ctx.strokeStyle = item.kind === 'missile' ? '#f5cd69' : '#81dec3';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(item.x + item.width / 2, item.y + item.height / 2, item.width / 2, item.height / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    this.drawPowerIcon(ctx, item.kind, item.x + 8, item.y + 7, item.width - 16, item.height - 14);
    ctx.restore();
  }

  render() {
    // Fondo → avisos → enemigos → ítems → disparos → cuy → partículas.
    // Las coordenadas decorativas están fuera del campo, en el DOM.
    this.drawBackground();
    for (const explosion of this.explosions) {
      this.ctx.save();
      this.ctx.globalAlpha = explosion.life / 0.35;
      this.ctx.fillStyle = '#f5cd6940';
      this.ctx.strokeStyle = '#ffb52e';
      this.ctx.fillRect(explosion.x, explosion.y, explosion.width, explosion.height);
      this.ctx.strokeRect(explosion.x, explosion.y, explosion.width, explosion.height);
      this.ctx.restore();
    }
    this.enemies.forEach((enemy) => enemy.drawLaserWarning(this.ctx));
    this.enemies.forEach((enemy) => enemy.draw(this.ctx));
    this.minions.forEach((minion) => minion.draw(this.ctx));
    this.powerUps.forEach((item) => this.drawPowerUp(this.ctx, item));
    this.projectiles.forEach((p) => p.draw(this.ctx));
    this.enemyProjectiles.forEach((p) => p.draw(this.ctx));
    this.player.draw(this.ctx);
    for (const p of this.particles) {
      this.ctx.globalAlpha = Math.max(0, p.life / 0.28);
      this.ctx.fillStyle = p.color;
      this.ctx.fillRect(p.x, p.y, 4, 4);
    }
    this.ctx.globalAlpha = 1;
    if (this.damageFlash > 0) {
      this.ctx.fillStyle = '#ff547d18';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  syncAudio() {
    this.audio?.update({ playing: this.state === 'playing', wave: this.wave,
      boss: this.enemies.some((enemy) => enemy.alive && enemy.isTrueForm) });
  }

  destroy() { this.sessionController?.abort(); this.input.destroy(); this.audio?.destroy(); this.leaderboard?.destroy(); this.controller.abort(); }
}
