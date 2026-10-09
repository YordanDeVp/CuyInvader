import { InputHandler } from './InputHandler.js';
import { Player } from './entities/Player.js';
import { Enemy } from './entities/Enemy.js';

const FORMATIONS = ['grid', 'triangle', 'crescent'];
const FORMATION_NAMES = { grid: 'BLOQUE', triangle: 'TRIÁNGULO', crescent: 'SEMILUNA' };
const FORMATION_INTERVAL = 20;
const LASER_INTERVAL = 10;

export class Game {
  // Conecta el mundo, la interfaz y los controles sin iniciar otro game loop.
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) throw new Error('No se pudo iniciar Canvas 2D.');
    this.ctx.imageSmoothingEnabled = false;
    this.ui = Object.fromEntries(['score', 'wave', 'speed', 'health', 'formation', 'formation-time', 'laser-time', 'bosses', 'fullscreen', 'pause', 'status', 'overlay', 'overlay-kicker', 'overlay-title', 'overlay-message', 'overlay-hint', 'play', 'restart', 'announcement'].map((id) => [id, document.getElementById(id)]));
    this.assets = this.loadAssets();
    this.input = new InputHandler((code) => this.handleAction(code));
    this.controller = new AbortController();
    const options = { signal: this.controller.signal };
    this.ui.play.addEventListener('click', () => this.play(), options);
    this.ui.pause.addEventListener('click', () => this.togglePause(), options);
    this.ui.restart.addEventListener('click', () => this.restart(), options);
    this.ui.fullscreen.addEventListener('click', () => this.toggleFullscreen(), options);
    document.addEventListener('fullscreenchange', () => {
      this.ui.fullscreen.textContent = document.fullscreenElement ? 'SALIR ⤡' : 'AMPLIAR ⤢';
    }, options);
    // Pausamos al perder foco: volver a la pestaña nunca causa una derrota invisible.
    window.addEventListener('blur', () => this.pause(), options);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    }, options);
    this.reset('ready');
  }

  // Cada imagen se solicita una sola vez; su ausencia nunca bloquea el inicio.
  loadAssets() {
    const assets = {};
    for (const [key, file] of Object.entries({ player: 'cuy-ametralladora.png', pilot: 'cuy.png', projectile: 'choclo.png', chavin: 'cabeza-clava.png', moche: 'huaco.png', boss: 'jefe-chavin.png' })) {
      const image = new Image();
      image.onerror = () => { image.onerror = null; };
      image.src = new URL(`../assets/${file}`, import.meta.url).href;
      assets[key] = image;
    }
    return assets;
  }

  // Reconstruye una partida completa y descarta entidades de la partida anterior.
  reset(state = 'playing') {
    this.state = state;
    this.score = 0;
    this.wave = 0;
    this.projectiles = [];
    this.enemyProjectiles = [];
    this.particles = [];
    this.formationIndex = 0;
    this.formationElapsed = 0;
    this.laserElapsed = 0;
    this.damageFlash = 0;
    this.defeatReason = '';
    this.input.clear();
    this.player = new Player(this.canvas.width, this.canvas.height, this.assets.player, this.assets.projectile, this.assets.pilot);
    this.spawnWave();
    this.syncUI();
  }

  // Crea una formación centrada y aplica la velocidad de la nueva oleada.
  spawnWave() {
    this.wave += 1;
    this.enemySpeed = Enemy.speedForWave(this.wave);
    this.formation = { x: this.canvas.width / 2, y: 48, direction: this.wave % 2 === 1 ? 1 : -1, halfWidth: 392 };
    this.enemies = [];
    Enemy.slotsForFormation(FORMATIONS[this.formationIndex]).forEach((slot, index) => {
      const type = index < 18 ? 'chavin' : 'moche';
      this.enemies.push(new Enemy(slot, type, this.assets[type], index));
    });
    for (let index = 0; index < 3; index += 1) {
      this.enemies.push(new Enemy({ x: (index - 1) * 236, y: 0 }, 'boss', this.assets.boss, index));
    }
    this.enemies.forEach((enemy) => enemy.update(0, this.formation));
    // Cada nueva guardia concede diez segundos antes de su primera descarga.
    this.laserElapsed = 0;
    this.enemyProjectiles = [];
    this.ui.announcement.textContent = `Oleada ${this.wave}.`;
    this.syncUI();
  }

  // Las acciones discretas se procesan una vez por pulsación.
  handleAction(code) {
    if (['Enter', 'Space'].includes(code) && ['ready', 'over'].includes(this.state)) this.play();
    else if (['KeyP', 'Escape', 'Enter'].includes(code)) this.togglePause();
    else if (code === 'KeyR') this.restart();
  }

  // Inicia, reanuda o prepara una nueva partida tras la derrota.
  play() {
    if (this.state === 'over') this.reset();
    this.state = 'playing';
    this.syncUI();
    this.canvas.focus({ preventScroll: true });
  }

  // El reinicio reutiliza el mismo bucle de animación.
  restart() {
    this.reset();
    this.canvas.focus({ preventScroll: true });
  }

  // Congela la simulación y libera las entradas que quedaron presionadas.
  pause() {
    this.input.clear();
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.syncUI();
  }

  // Solo alterna entre los estados de partida y pausa.
  togglePause() {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.play();
  }

  // La pantalla completa conserva la misma simulación y los mismos controles.
  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.querySelector('.arcade').requestFullscreen();
      this.canvas.focus({ preventScroll: true });
    } catch {
      this.ui.announcement.textContent = 'La pantalla completa no está disponible en este navegador.';
    }
  }

  // El reloj cuenta solo tiempo de juego y continúa entre oleadas.
  updateFormation(deltaTime) {
    this.formationElapsed += deltaTime;
    if (this.formationElapsed + 1e-9 >= FORMATION_INTERVAL) {
      this.formationElapsed = Math.max(0, this.formationElapsed - FORMATION_INTERVAL);
      this.formationIndex = (this.formationIndex + 1) % FORMATIONS.length;
      const name = FORMATIONS[this.formationIndex];
      const slots = Enemy.slotsForFormation(name);
      this.enemies.forEach((enemy) => {
        if (!enemy.isBoss) enemy.setSlot(slots[enemy.index]);
      });
      this.ui.announcement.textContent = `Nueva formación: ${FORMATION_NAMES[name]}.`;
    }
    Enemy.advanceFormation(this.formation, this.enemySpeed, deltaTime, this.canvas.width);
    this.enemies.forEach((enemy) => enemy.update(deltaTime, this.formation));
  }

  // Un segundo de aviso, seguido de dos proyectiles por jefe cada diez segundos.
  updateLasers(deltaTime) {
    this.laserElapsed += deltaTime;
    if (this.laserElapsed + 1e-9 >= LASER_INTERVAL - 1) {
      this.enemies.forEach((enemy) => enemy.prepareLaser(this.player));
    }
    if (this.laserElapsed + 1e-9 >= LASER_INTERVAL) {
      this.laserElapsed = Math.max(0, this.laserElapsed - LASER_INTERVAL);
      this.enemies.forEach((enemy) => this.enemyProjectiles.push(...enemy.fireLasers()));
    }
  }

  endGame(reason) {
    this.defeatReason = reason;
    this.state = 'over';
    this.input.clear();
    this.syncUI();
  }

  // AABB: dos rectángulos colisionan cuando se superponen en ambos ejes.
  static overlaps(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }

  // Orden del paso: movimiento, impactos, limpieza y transición de estado.
  update(deltaTime) {
    if (this.state !== 'playing') return;
    this.damageFlash = Math.max(0, this.damageFlash - deltaTime);
    this.player.update(deltaTime, this.input, this.canvas.width);
    if (this.input.isDown('Space')) {
      const projectile = this.player.shoot();
      if (projectile) this.projectiles.push(projectile);
    }
    this.projectiles.forEach((projectile) => projectile.update(deltaTime, this.canvas.width, this.canvas.height));
    this.updateFormation(deltaTime);

    // Cada choclo destruye como máximo un enemigo; los ya destruidos se ignoran.
    for (const projectile of this.projectiles) {
      if (!projectile.active) continue;
      for (const enemy of this.enemies) {
        if (!enemy.alive || !Game.overlaps(projectile, enemy)) continue;
        projectile.active = false;
        enemy.takeHit();
        if (!enemy.alive) {
          this.score += enemy.points;
          this.burst(enemy);
        }
        break;
      }
    }
    this.projectiles = this.projectiles.filter((projectile) => projectile.active);
    this.enemies = this.enemies.filter((enemy) => enemy.alive);
    this.updateLasers(deltaTime);
    for (const laser of this.enemyProjectiles) {
      laser.update(deltaTime, this.canvas.width, this.canvas.height);
      if (laser.active && Game.overlaps(laser, this.player.hitbox)) {
        laser.active = false;
        if (this.player.takeHit()) {
          this.damageFlash = 0.2;
          this.burst(this.player, '#ff547d');
          this.ui.announcement.textContent = `Impacto. Resistencia: ${this.player.health} de 3.`;
        }
      }
    }
    this.enemyProjectiles = this.enemyProjectiles.filter((laser) => laser.active);
    this.particles.forEach((particle) => {
      particle.x += particle.vx * deltaTime;
      particle.y += particle.vy * deltaTime;
      particle.life -= deltaTime;
    });
    this.particles = this.particles.filter((particle) => particle.life > 0);

    if (this.player.health <= 0) {
      this.endGame('Los láseres alcanzaron tu ametralladora.');
      return;
    }
    if (this.enemies.some((enemy) => Game.overlaps(enemy, this.player.hitbox) || enemy.y + enemy.height >= this.player.hitbox.y)) {
      this.endGame('Las reliquias llegaron al valle.');
      return;
    }
    // Sin temporizadores: la siguiente oleada nace en el mismo paso de simulación.
    if (this.enemies.length === 0) {
      this.projectiles = [];
      this.spawnWave();
    }
    this.syncHUD();
  }

  // Partículas breves confirman visualmente cada impacto.
  burst(enemy, color = '#f1ba62') {
    for (let i = 0; i < 8; i += 1) {
      const angle = i * Math.PI / 4;
      this.particles.push({ x: enemy.x + enemy.width / 2, y: enemy.y + enemy.height / 2, vx: Math.cos(angle) * 100, vy: Math.sin(angle) * 100, life: 0.28, color });
    }
  }

  // Solo modifica textos cuando cambian, sin reescribir el panel en cada frame.
  syncHUD() {
    const bosses = this.enemies.filter((enemy) => enemy.isBoss).length;
    const values = {
      score: String(this.score).padStart(6, '0'),
      wave: String(this.wave).padStart(2, '0'),
      speed: `${(this.enemySpeed / 64).toFixed(2)}×`,
      health: '♥'.repeat(this.player.health) + '·'.repeat(3 - this.player.health),
      formation: FORMATION_NAMES[FORMATIONS[this.formationIndex]],
      'formation-time': `${Math.ceil(FORMATION_INTERVAL - this.formationElapsed)}s`,
      'laser-time': bosses === 0 ? 'DESPEJADO' : this.laserElapsed >= 9 ? '¡ESQUIVA!' : `${Math.ceil(LASER_INTERVAL - this.laserElapsed)}s`,
      bosses: `${bosses}/3`,
    };
    for (const [key, value] of Object.entries(values)) {
      if (this.ui[key].textContent !== value) this.ui[key].textContent = value;
    }
    this.ui.health.setAttribute('aria-label', `Resistencia: ${this.player.health} de 3`);
  }

  // Actualiza el HUD y el panel correspondiente al estado actual.
  syncUI() {
    this.syncHUD();
    this.ui.status.textContent = { ready: 'EN ESPERA', playing: 'EN EL VALLE', paused: 'EN PAUSA', over: 'FIN DE PARTIDA' }[this.state];
    this.ui.pause.disabled = !['playing', 'paused'].includes(this.state);
    this.ui.pause.textContent = this.state === 'paused' ? '▶' : 'Ⅱ';
    this.ui.pause.setAttribute('aria-label', this.state === 'paused' ? 'Reanudar partida' : 'Pausar partida');
    this.ui.overlay.hidden = this.state === 'playing';
    const copy = {
      ready: ['UN CUY. UNA AMETRALLADORA.', 'Defiende\nlos Andes.', 'Lluvia de choclos. Formaciones cada 20s. Esquiva los láseres de los guardianes y protege el valle.', 'JUGAR', 'MANTÉN ESPACIO PARA DISPARAR'],
      paused: ['TOMA UN RESPIRO.', 'Valle en pausa.', 'Tu cuy te espera. Vuelve cuando estés listo.', 'CONTINUAR', 'O PRESIONA P / ENTER'],
      over: [this.defeatReason.toUpperCase(), '¡Buen intento!', `${this.score} puntos · Oleada ${this.wave}. Otro cuy, otra oportunidad.`, 'VOLVER A JUGAR', 'O PRESIONA ENTER / ESPACIO'],
    }[this.state];
    if (copy) {
      this.ui['overlay-kicker'].textContent = copy[0];
      this.ui['overlay-title'].textContent = copy[1];
      this.ui['overlay-title'].style.whiteSpace = 'pre-line';
      this.ui['overlay-message'].textContent = copy[2];
      this.ui.play.textContent = `${copy[3]} ↗`;
      this.ui['overlay-hint'].textContent = copy[4];
      this.ui.announcement.textContent = `${copy[1]} ${copy[2]}`;
    }
  }

  // El escenario completo se dibuja sin depender de archivos externos.
  drawBackground() {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    ctx.fillStyle = '#0c151c';
    ctx.fillRect(0, 0, width, height);
    // Cielo determinista y montañas escalonadas: sin imágenes ni aleatoriedad por frame.
    for (let i = 0; i < 100; i += 1) {
      ctx.fillStyle = i % 4 === 0 ? '#63847e' : '#2f484e';
      ctx.fillRect((i * 137 + 31) % width, (i * 83 + 17) % (height - 90), 2, 2);
    }
    ctx.fillStyle = '#d9c794';
    ctx.fillRect(width - 90, 28, 22, 22);
    ctx.fillStyle = '#0c151c';
    ctx.fillRect(width - 84, 25, 20, 18);
    for (let layer = 0; layer < 2; layer += 1) {
      ctx.fillStyle = layer === 0 ? '#172a30' : '#1c3538';
      for (let x = 0; x < width; x += 16) {
        const peak = Math.abs(((x + layer * 110) % 320) - 160);
        const top = height * 0.67 + layer * 75 + Math.floor(peak * 0.65 / 16) * 16;
        ctx.fillRect(x, top, 16, height - top);
      }
    }
    ctx.fillStyle = '#476761';
    ctx.fillRect(18, this.player.y + this.player.height + 12, width - 36, 1);
  }

  // Dibuja por capas y restaura la opacidad antes del próximo frame.
  render() {
    this.drawBackground();
    this.enemies.forEach((enemy) => enemy.drawLaserWarning(this.ctx));
    this.enemies.forEach((enemy) => enemy.draw(this.ctx));
    this.projectiles.forEach((projectile) => projectile.draw(this.ctx));
    this.enemyProjectiles.forEach((projectile) => projectile.draw(this.ctx));
    this.player.draw(this.ctx);
    this.particles.forEach((particle) => {
      this.ctx.globalAlpha = Math.max(0, particle.life / 0.28);
      this.ctx.fillStyle = particle.color;
      this.ctx.fillRect(particle.x, particle.y, 4, 4);
    });
    this.ctx.globalAlpha = 1;
    if (this.damageFlash > 0) {
      this.ctx.fillStyle = '#ff547d18';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  // Retira listeners cuando se desmonta definitivamente el juego.
  destroy() {
    this.input.destroy();
    this.controller.abort();
  }
}
