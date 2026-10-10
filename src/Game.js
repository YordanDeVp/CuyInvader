import { InputHandler } from './InputHandler.js';
import { Player } from './entities/Player.js';
import { Enemy, Minion } from './entities/Enemy.js';

const FORMATIONS = ['grid', 'triangle', 'crescent'];
const NAMES = { grid: 'BLOQUE', triangle: 'TRIÁNGULO', crescent: 'SEMILUNA' };
const FORMATION_INTERVAL = 7;
const LASER_INTERVAL = 10;

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
      'overlay-title', 'overlay-message', 'overlay-hint', 'play', 'restart', 'announcement',
      'item', 'item-icon', 'item-status', 'drop-progress', 'touch-power', 'reveal', 'start-fullscreen', 'fullscreen-message'];
    this.ui = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
    this.assets = this.loadAssets();
    this.input = new InputHandler((code) => this.handleAction(code));
    this.controller = new AbortController();
    const options = { signal: this.controller.signal };
    this.ui.play.addEventListener('click', () => this.play(), options);
    // Un HTML anterior puede seguir en caché unos segundos durante el despliegue.
    this.ui['start-fullscreen']?.addEventListener('click', () => this.playFullscreen(), options);
    this.ui.pause.addEventListener('click', () => this.togglePause(), options);
    this.ui.restart.addEventListener('click', () => this.restart(), options);
    this.ui.fullscreen.addEventListener('click', () => this.toggleFullscreen(), options);
    this.ui.item.addEventListener('click', () => this.activateJalapeno(), options);
    window.addEventListener('resize', () => this.resize(), options);
    window.visualViewport?.addEventListener('resize', () => this.resize(), options);
    window.addEventListener('blur', () => this.pause(), options);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    }, options);
    document.addEventListener('fullscreenchange', () => {
      this.ui.fullscreen.textContent = document.fullscreenElement ? 'SALIR ⤡' : 'AMPLIAR ⤢';
      this.resize();
      this.syncUI();
    }, options);
    this.resize();
    this.reset('ready');
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
    const mobile = window.matchMedia('(max-width: 640px)').matches;
    const width = mobile ? 600 : 1200;
    const visibleHeight = window.visualViewport?.height ?? window.innerHeight;
    const height = mobile ? Math.round(Math.max(900, Math.min(1200, (visibleHeight - (document.fullscreenElement ? 110 : 166)) / window.innerWidth * 600))) : 800;
    const oldWidth = this.canvas.width;
    const oldHeight = this.canvas.height;
    if (oldWidth === width && oldHeight === height && this.layout) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx.imageSmoothingEnabled = false;
    const touch = mobile || window.matchMedia('(pointer: coarse)').matches;
    this.bottomSpace = touch ? Math.max(155, 100 * width / Math.max(1, this.canvas.clientWidth)) : 28;
    if (!this.player) return;
    this.pause();
    this.player.x *= width / oldWidth;
    this.player.resize(width, height, this.bottomSpace);
    this.layout = Enemy.layout(this.wave, width, height);
    this.formation.halfWidth = this.layout.span / 2;
    this.formation.x = Math.max(12 + this.formation.halfWidth, Math.min(width - 12 - this.formation.halfWidth, this.formation.x * width / oldWidth));
    this.formation.y *= height / oldHeight;
    const slots = Enemy.slotsForFormation(FORMATIONS[this.formationIndex], this.layout);
    this.enemies.forEach((enemy) => {
      enemy.resize(this.layout);
      enemy.setSlot(enemy.isBoss ? Enemy.bossSlot(enemy.index, this.layout) : slots[enemy.index], true);
      enemy.update(0, this.formation);
    });
    this.minions.forEach((minion) => minion.resize(this.layout));
    for (const entity of [...this.projectiles, ...this.enemyProjectiles, ...this.powerUps, ...this.particles, ...this.minions]) {
      entity.x *= width / oldWidth;
      entity.y *= height / oldHeight;
    }
    this.syncUI();
  }

  reset(state = 'playing') {
    this.state = state;
    this.score = 0;
    this.wave = 0;
    this.projectiles = [];
    this.enemyProjectiles = [];
    this.particles = [];
    this.powerUps = [];
    this.minions = [];
    this.inventory = null;
    this.guardiansDefeated = 0;
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
  }

  spawnWave() {
    this.wave += 1;
    this.enemySpeed = Enemy.speedForWave(this.wave);
    this.layout = Enemy.layout(this.wave, this.canvas.width, this.canvas.height);
    this.formation = { x: this.canvas.width / 2, y: 36, direction: this.wave % 2 ? 1 : -1, halfWidth: this.layout.span / 2 };
    this.enemies = Enemy.slotsForFormation(FORMATIONS[this.formationIndex], this.layout).map((slot, index) => {
      const type = index % 2 ? 'moche' : 'chavin';
      return new Enemy(slot, type, this.assets[type], index, this.wave, this.layout);
    });
    const impostor = Math.floor(Math.random() * this.layout.bosses);
    for (let index = 0; index < this.layout.bosses; index += 1) {
      this.enemies.push(new Enemy(Enemy.bossSlot(index, this.layout), 'boss', this.assets.chavin, index, this.wave, this.layout, index === impostor));
    }
    this.enemies.forEach((enemy) => enemy.update(0, this.formation));
    this.laserElapsed = 0;
    this.enemyProjectiles = [];
    this.minions = [];
    this.revealTime = 0;
    this.syncUI();
    this.announce('Oleada ' + this.wave + '. ' + this.layout.count + ' tropas y ' + this.layout.bosses + ' guardianes.');
  }

  announce(message) { this.ui.announcement.textContent = message; }

  handleAction(code) {
    if (['ControlLeft', 'ControlRight'].includes(code)) this.activateJalapeno();
    else if (['Enter', 'Space'].includes(code) && ['ready', 'over'].includes(this.state)) this.play();
    else if (['KeyP', 'Escape', 'Enter'].includes(code)) this.togglePause();
    else if (code === 'KeyR') this.restart();
  }

  play() {
    if (this.state === 'over') this.reset();
    this.state = 'playing';
    this.syncUI();
    this.canvas.focus({ preventScroll: true });
  }

  restart() { this.reset(); this.canvas.focus({ preventScroll: true }); }

  pause() {
    this.input.clear();
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.syncUI();
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

  async playFullscreen() {
    if (this.fullscreenPending) return;
    this.fullscreenPending = true;
    this.ui['start-fullscreen'].disabled = true;
    this.ui['fullscreen-message'].hidden = true;
    try {
      const container = document.querySelector('.arcade');
      if (!container.requestFullscreen) throw new Error('Fullscreen no disponible');
      // La petición se hace desde el clic, antes de iniciar la partida.
      if (!document.fullscreenElement) await container.requestFullscreen({ navigationUI: 'hide' });
      // Espera a que el navegador aplique el nuevo viewport antes de arrancar.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      this.resize();
      this.play();
    } catch {
      const message = 'No se pudo ampliar. Puedes jugar con el botón JUGAR.';
      this.ui['fullscreen-message'].textContent = message;
      this.ui['fullscreen-message'].hidden = false;
      this.announce(message);
    } finally {
      this.fullscreenPending = false;
      this.ui['start-fullscreen'].disabled = false;
    }
  }

  activateJalapeno() {
    if (this.state !== 'playing' || !this.inventory || this.player.powerTime > 0) return;
    this.inventory = null;
    this.player.activatePower();
    this.announce('¡Jalapeño activado! Ocho segundos de choclos triples en llamas.');
    this.syncHUD();
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
    this.laserElapsed += dt;
    if (this.laserElapsed + 1e-9 >= LASER_INTERVAL - 1) this.enemies.forEach((enemy) => enemy.prepareLaser(this.player));
    if (this.laserElapsed + 1e-9 >= LASER_INTERVAL) {
      this.laserElapsed = Math.max(0, this.laserElapsed - LASER_INTERVAL);
      this.enemies.forEach((enemy) => this.enemyProjectiles.push(...enemy.fireLasers()));
    }
  }

  updateSummons() {
    for (const boss of this.enemies) {
      if (!boss.consumeSummon()) continue;
      for (let index = 0; index < 4; index += 1) {
        const minion = new Minion(0, boss.y + boss.height + 18, this.assets.moche, this.wave, this.layout);
        const center = boss.x + boss.width / 2 + (index - 1.5) * (minion.width + 10);
        minion.x = Math.max(8, Math.min(this.canvas.width - minion.width - 8, center - minion.width / 2));
        // Nacen delante del jefe, con un margen para que el cuy pueda reaccionar.
        minion.y = Math.min(minion.y, this.player.hitbox.y - minion.height - 90);
        this.minions.push(minion);
      }
      this.bossNotice = '¡EL IMPOSTOR INVOCA 4 SECUACES!';
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
    this.syncUI();
  }

  static overlaps(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }

  defeatEnemy(enemy) {
    this.score += enemy.points;
    this.burst(enemy);
    if (!enemy.isBoss) return;
    this.guardiansDefeated += 1;
    // El contador persiste entre oleadas; la primera fase del impostor no suma.
    if (this.guardiansDefeated % 5 === 0) {
      this.powerUps.push({ x: enemy.x + enemy.width / 2 - 18, y: enemy.y, width: 36, height: 44 });
      this.announce('¡Jalapeño! Atrápalo y guárdalo para activar con Ctrl.');
    }
  }

  updatePowerUps(dt) {
    this.powerUps = this.powerUps.filter((item) => {
      item.y += 125 * dt;
      if (!this.inventory && Game.overlaps(item, this.player.hitbox)) {
        this.inventory = 'jalapeno';
        this.announce('Jalapeño guardado. Pulsa Ctrl o el botón de poder.');
        return false;
      }
      // Con el inventario lleno el ítem sigue cayendo: nunca reemplaza al guardado.
      return item.y <= this.canvas.height;
    });
  }

  update(dt) {
    if (this.state !== 'playing') return;
    this.damageFlash = Math.max(0, this.damageFlash - dt);
    this.revealTime = Math.max(0, this.revealTime - dt);
    this.player.update(dt, this.input, this.canvas.width);
    if (this.input.isDown('Space')) this.projectiles.push(...this.player.shoot());
    this.projectiles.forEach((p) => p.update(dt, this.canvas.width, this.canvas.height));
    this.updateFormation(dt);
    this.minions.forEach((minion) => minion.update(dt, this.player, this.canvas.width, this.canvas.height));
    const targets = [...this.enemies, ...this.minions];
    for (const projectile of this.projectiles) {
      if (!projectile.active) continue;
      for (const enemy of targets) {
        if (!enemy.alive || !Game.overlaps(projectile, enemy)) continue;
        projectile.active = false;
        const result = enemy.takeHit();
        if (result === 'defeated') this.defeatEnemy(enemy);
        if (result === 'reveal') {
          this.revealTime = 3;
          this.bossNotice = '¡IMPOSTOR REVELADO! DERROTA SU VERDADERA FORMA';
          this.burst(enemy, '#d63222');
          this.announce('¡Impostor revelado! Su verdadera forma tiene una nueva barra de vida.');
        }
        break;
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.active);
    this.enemies = this.enemies.filter((enemy) => enemy.alive);
    // Se resuelven primero los impactos: un jefe derrotado no puede invocar.
    this.updateSummons();
    this.updateLasers(dt);
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
    this.updatePowerUps(dt);
    this.particles.forEach((p) => { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; });
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.player.health <= 0) { this.endGame('Tu ametralladora se quedó sin resistencia.'); return; }
    if (this.enemies.some((enemy) => enemy.y + enemy.height >= this.player.hitbox.y)) {
      this.endGame('Las reliquias llegaron al valle.');
      return;
    }
    if (!this.enemies.length && !this.minions.length) { this.projectiles = []; this.spawnWave(); }
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
      'laser-time': bosses ? (this.laserElapsed >= 9 ? '¡ESQUIVA!' : Math.ceil(LASER_INTERVAL - this.laserElapsed) + 's') : '—',
      bosses: this.layout.bosses ? bosses + '/' + this.layout.bosses : 'DESDE N.3',
      'boss-phase': this.minions.length ? this.minions.length + ' SECUACES' : this.enemies.some((enemy) => enemy.isTrueForm) ? 'IMPOSTOR' : '',
      'item-status': this.player.powerTime > 0 ? Math.ceil(this.player.powerTime) + 's TRIPLE' : this.inventory ? 'LISTO · CTRL' : 'VACÍO',
      'drop-progress': this.guardiansDefeated % 5 + '/5 GUARDIANES',
    };
    for (const [key, value] of Object.entries(values)) if (this.ui[key].textContent !== value) this.ui[key].textContent = value;
    const canUse = this.state === 'playing' && Boolean(this.inventory) && this.player.powerTime === 0;
    this.ui.item.disabled = !canUse;
    this.ui['touch-power'].disabled = !canUse;
    this.ui.item.classList.toggle('loaded', Boolean(this.inventory));
    this.ui.item.classList.toggle('active', this.player.powerTime > 0);
    this.ui.reveal.hidden = this.revealTime <= 0 || this.state !== 'playing';
    if (this.ui.reveal.textContent !== this.bossNotice) this.ui.reveal.textContent = this.bossNotice;
    this.ui.health.setAttribute('aria-label', 'Resistencia: ' + this.player.health + ' de 3');
  }

  syncUI() {
    this.syncHUD();
    this.ui.status.textContent = { ready: 'EN ESPERA', playing: 'EN EL VALLE', paused: 'EN PAUSA', over: 'FIN DE PARTIDA' }[this.state];
    this.ui.pause.disabled = !['playing', 'paused'].includes(this.state);
    this.ui.pause.textContent = this.state === 'paused' ? '▶' : 'Ⅱ';
    this.ui.pause.setAttribute('aria-label', this.state === 'paused' ? 'Reanudar partida' : 'Pausar partida');
    this.ui.overlay.hidden = this.state === 'playing';
    if (this.ui['start-fullscreen']) this.ui['start-fullscreen'].hidden = Boolean(document.fullscreenElement);
    const copy = {
      ready: ['UN CUY. UNA AMETRALLADORA.', 'Defiende\nlos Andes.', 'Formaciones cada 7s. Esquiva los láseres y activa choclos en llamas con el jalapeño. Desde el nivel 7, el impostor oscuro puede invocar secuaces.', 'JUGAR', 'FLECHAS / A D · ESPACIO · CTRL'],
      paused: ['TOMA UN RESPIRO.', 'Valle en pausa.', 'Tu cuy te espera. Continúa cuando estés listo.', 'CONTINUAR', 'O PRESIONA P / ENTER'],
      over: [this.defeatReason.toUpperCase(), '¡Buen intento!', this.score + ' puntos · Oleada ' + this.wave + '. Otro cuy, otra oportunidad.', 'VOLVER A JUGAR', 'O PRESIONA ENTER / ESPACIO'],
    }[this.state];
    if (copy) {
      this.ui['overlay-kicker'].textContent = copy[0];
      this.ui['overlay-title'].textContent = copy[1];
      this.ui['overlay-message'].textContent = copy[2];
      this.ui.play.textContent = copy[3] + ' ↗';
      this.ui['overlay-hint'].textContent = copy[4];
    }
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

  render() {
    // Fondo → avisos → enemigos → ítems → disparos → cuy → partículas.
    // Las coordenadas decorativas están fuera del campo, en el DOM.
    this.drawBackground();
    this.enemies.forEach((enemy) => enemy.drawLaserWarning(this.ctx));
    this.enemies.forEach((enemy) => enemy.draw(this.ctx));
    this.minions.forEach((minion) => minion.draw(this.ctx));
    this.powerUps.forEach((item) => this.drawJalapeno(this.ctx, item.x, item.y, item.width, item.height));
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
    const icon = this.ui['item-icon'].getContext('2d');
    icon.clearRect(0, 0, 32, 40);
    icon.imageSmoothingEnabled = false;
    icon.globalAlpha = this.inventory || this.player.powerTime > 0 ? 1 : 0.3;
    this.drawJalapeno(icon, 2, 2, 28, 36);
  }

  destroy() { this.input.destroy(); this.controller.abort(); }
}
