import { Projectile } from './Projectile.js';
import { ENDGAME_WAVE, SUMMON_INTERVAL, MINION_POINTS, guardianCountForWave,
  bossHealthForWave, minionHealthMultiplierForWave, MAX_SPEED_MULTIPLIER,
  LASER_BURST_DELAY, EXTREME_WAVE } from '../GameRules.js';

const DESCENT_INTERVAL = 3;

export class Enemy {
  constructor(slot, type, sprite, index, wave, layout, impostor = false) {
    this.type = type;
    this.isBoss = type === 'boss';
    this.isImpostor = impostor;
    this.isTrueForm = false;
    this.wave = wave;
    this.summonElapsed = 0;
    this.sprite = sprite;
    this.index = index;
    this.alive = true;
    this.maxHealth = this.isBoss ? bossHealthForWave(wave) : Enemy.troopHealthForWave(wave);
    this.health = this.maxHealth;
    this.points = this.isBoss ? 250 : type === 'chavin' ? 30 : 20;
    this.flash = 0;
    this.revealTime = 0;
    this.aim = null;
    this.hasLaserBurst = false;
    this.pendingLaser = null;
    this.resize(layout);
    this.setSlot(slot, true);
  }

  static guardianCount(wave) { return guardianCountForWave(wave); }
  static speedForWave(wave) { return 64 * Math.min(MAX_SPEED_MULTIPLIER, 1.1 ** (wave - 1)); }
  static troopHealthForWave(wave) { return 1 + Math.floor((wave - 1) / 3); }

  // La densidad crece hasta 72 tropas; la velocidad lateral se limita a 7x.
  static layout(wave, width, height, playerY = height - (width <= 640 ? 64.5 : 86) - 28, retainedCount = null) {
    const mobile = width <= 640;
    let gap = 12;
    const startY = 8; // Offset superior: primera fila a ocho píxeles del borde.
    const safetyMargin = 96;
    const spawnLimit = playerY - safetyMargin;
    const bosses = Enemy.guardianCount(wave);
    const baseSize = mobile ? 32 : 46;
    // Reserva el ancho de la forma revelada: seis jefes caben incluso en móvil.
    const bossSize = Math.min(mobile ? 52 : 72,
      bosses ? (width - baseSize * 5 - (bosses - 1) * gap) / (bosses * 1.8) : Infinity);
    const bossFootprint = bosses >= 6 ? bossSize * 1.8 : bossSize;
    let size = baseSize;
    const columns = Math.min((mobile ? 8 : 12) + Math.floor((wave - 1) / 3), Math.floor((width - baseSize * 5) / (baseSize * 1.15)));
    const availableColumns = Math.max(2, Math.min(columns, Math.floor((width - size * 5 + gap) / (size + gap))));
    const troopTop = bosses ? bossFootprint + gap : 0;
    const availableHeight = Math.max(1, spawnLimit - startY - troopTop);
    const maxRows = Math.max(1, Math.floor((availableHeight + gap) / (size + gap)));
    // La forma más alta es el triángulo: recortamos tropas antes de crearlas,
    // nunca enemigos vivos durante una transición. Su vida sigue escalando.
    const count = retainedCount ?? Math.min(72, 36 + (wave - 1) * 4, Math.floor(maxRows * availableColumns / 2));
    const triangleRows = Math.ceil(count * 2 / availableColumns);
    // En móviles muy bajos, conservar tropas al rotar requiere comprimir
    // también el hueco vertical. Nunca se empujan enemigos contra el cuy.
    if (retainedCount !== null) {
      gap = Math.min(gap, Math.max(0, (availableHeight - triangleRows * 8) / Math.max(1, triangleRows - 1)));
    }
    // Al rotar la pantalla conservamos las tropas y sus índices; ajustamos el
    // tamaño, no el número de enemigos pendientes de la oleada en curso.
    size = Math.min(size, Math.max(1, (availableHeight - (triangleRows - 1) * gap) / triangleRows));
    const depth = (triangleRows - 1) * (size + gap);
    // En cada borde quedan exactamente 2,5 cabezas al centrar el bloque.
    return { count, columns: availableColumns, size, span: width - size * 5, height: depth,
      bossSize, bossFootprint, top: troopTop + size / 2, bosses, mobile, gap, startY, safetyMargin, spawnLimit };
  }

  static slotsForFormation(name, layout) {
    const { count, columns, size, span, top, height } = layout;
    const rows = name === 'triangle' ? Math.ceil(count * 2 / columns) : Math.ceil(count / columns);
    let rowCounts;
    if (name === 'triangle') {
      const weight = rows * (rows + 1) / 2;
      rowCounts = Array.from({ length: rows }, (_, row) => Math.max(1, Math.min(columns, Math.floor(count * (row + 1) / weight))));
      let remaining = count - rowCounts.reduce((sum, n) => sum + n, 0);
      while (remaining > 0) {
        for (let row = rows - 1; row >= 0 && remaining > 0; row -= 1) {
          if (rowCounts[row] < columns) { rowCounts[row] += 1; remaining -= 1; }
        }
      }
    } else {
      rowCounts = Array.from({ length: rows }, (_, row) => Math.min(columns, count - row * columns));
    }
    const pitch = (span - size) / Math.max(1, columns - 1);
    const gap = size + layout.gap; // Separación libre mínima de 12 px por fila.
    const slots = [];
    rowCounts.forEach((amount, row) => {
      for (let column = 0; column < amount; column += 1) {
        const x = (column - (amount - 1) / 2) * pitch;
        const unit = x / (span / 2);
        const arc = name === 'crescent' ? (1 - Math.sqrt(Math.max(0, 1 - unit * unit))) * height * 0.45 : 0;
        // Índices centrados en una cuadrícula común, independientes del arco.
        slots.push({ x, y: top + row * gap + arc, row,
          column: column + Math.floor((columns - amount) / 2) });
      }
    });
    // Las formas comparten la misma franja vertical. Antes, el triángulo
    // ganaba hasta 147 px hacia el valle y podía causar una derrota al cambiar.
    const minY = Math.min(...slots.map((slot) => slot.y));
    const maxY = Math.max(...slots.map((slot) => slot.y));
    for (const slot of slots) {
      slot.y = top + (maxY > minY ? (slot.y - minY) / (maxY - minY) * height : height);
    }
    return slots;
  }

  static bossSlot(index, layout) {
    const span = layout.span - layout.bossSize * 1.8;
    return { x: (index / Math.max(1, layout.bosses - 1) - 0.5) * span, y: layout.bossSize / 2 };
  }

  static advanceFormation(formation, speed, dt, canvasWidth) {
    if (dt <= 0 || speed <= 0) return;
    // El +10 % afecta al movimiento lateral. Los márgenes estrechos no deben
    // multiplicar el descenso: como máximo un escalón cada tres segundos.
    formation.descentElapsed = Math.min(DESCENT_INTERVAL, (formation.descentElapsed ?? 0) + dt);
    const left = 12 + formation.halfWidth;
    const right = canvasWidth - 12 - formation.halfWidth;
    const available = Math.max(0, formation.direction > 0 ? right - formation.x : formation.x - left);
    const distance = speed * dt;
    formation.x += formation.direction * Math.min(distance, available);
    if (distance >= available) {
      formation.direction *= -1;
      if (formation.descentElapsed + 1e-9 >= DESCENT_INTERVAL) {
        formation.y += 8;
        formation.descentElapsed = 0;
      }
    }
  }

  resize(layout) {
    this.width = (this.isBoss ? layout.bossSize : layout.size) * (this.isTrueForm ? 1.8 : 1) * (this.sizeMultiplier ?? 1);
    this.height = this.width;
    this.laserSpeed = layout.mobile ? 170 : 210;
  }

  // Coordenadas locales del centro: el jefe crece sin saltar de posición.
  setSlot(slot, immediate = false) {
    this.cellRow = slot.row;
    this.cellColumn = slot.column;
    this.targetX = slot.x;
    this.targetY = slot.y;
    if (immediate) { this.offsetX = slot.x; this.offsetY = slot.y; }
  }

  update(dt, formation) {
    const blend = 1 - Math.exp(-4 * dt);
    this.offsetX += (this.targetX - this.offsetX) * blend;
    this.offsetY += (this.targetY - this.offsetY) * blend;
    this.x = formation.x + this.offsetX - this.width / 2;
    this.y = formation.y + this.offsetY - this.height / 2;
    this.flash = Math.max(0, this.flash - dt);
    this.revealTime = Math.max(0, this.revealTime - dt);
    if (this.alive && this.isBoss && this.wave >= ENDGAME_WAVE) this.summonElapsed += dt;
  }

  // Desde la oleada 5 cada jefe conserva su reloj de invocación independiente.
  consumeSummon() {
    if (!this.alive || !this.isBoss || this.wave < ENDGAME_WAVE || this.summonElapsed + 1e-9 < SUMMON_INTERVAL) return false;
    this.summonElapsed = Math.max(0, this.summonElapsed - SUMMON_INTERVAL);
    return true;
  }

  takeHit(damage = 1) {
    if (!this.alive || this.revealTime > 0) return 'hit';
    this.health -= damage;
    this.flash = 0.08;
    if (this.health > 0) return 'hit';
    if (this.isImpostor && !this.isTrueForm) {
      // La primera barra revela al impostor; solo su derrota definitiva cuenta.
      this.isTrueForm = true;
      this.maxHealth = Math.ceil(this.maxHealth * 2.2);
      this.health = this.maxHealth;
      this.x -= this.width * 0.4;
      this.y -= this.height * 0.4;
      this.width *= 1.8;
      this.height *= 1.8;
      this.points = 600;
      this.revealTime = 0.9;
      this.aim = null;
      this.pendingLaser = null;
      return 'reveal';
    }
    this.alive = false;
    return 'defeated';
  }

  get eyes() {
    return [0.32, 0.68].map((part) => ({ x: this.x + this.width * part, y: this.y + this.height * 0.4 }));
  }

  prepareLaser(player) {
    if (this.isBoss && this.alive && !this.aim && this.revealTime === 0) this.aim = player;
  }

  fireLasers() {
    if (!this.aim || !this.alive || this.revealTime > 0) return [];
    const speed = this.laserSpeed * (this.isTrueForm ? 1.2 : 1);
    if (this.hasLaserBurst) {
      // Exactamente dos disparos separados por 180 ms, no dos salvas completas.
      const [eye] = this.eyes;
      const target = this.aim;
      this.pendingLaser = { target, speed, remaining: LASER_BURST_DELAY };
      this.aim = null;
      return [Projectile.laser(eye.x, eye.y, target, speed, -0.12)];
    }
    const lasers = this.eyes.map((eye, index) => Projectile.laser(eye.x, eye.y, this.aim, speed, (index ? 1 : -1) * 0.12));
    if (this.isTrueForm) lasers.push(Projectile.laser(this.x + this.width / 2, this.y + this.height * 0.8, this.aim, speed));
    this.aim = null;
    return lasers;
  }

  updateLaserBurst(dt) {
    if (!this.alive || this.revealTime > 0) { this.pendingLaser = null; return []; }
    if (!this.pendingLaser) return [];
    this.pendingLaser.remaining -= dt;
    if (this.pendingLaser.remaining > 1e-9) return [];
    const { target, speed } = this.pendingLaser;
    this.pendingLaser = null;
    const eye = this.eyes[1];
    return [Projectile.laser(eye.x, eye.y, target, speed, 0.12)];
  }

  draw(ctx) {
    const { x, y, width: w, height: h } = this;
    ctx.save();
    if (this.isBoss) {
      ctx.fillStyle = this.isTrueForm ? '#140b0be6' : '#f1ba6220';
      ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
      ctx.strokeStyle = this.isTrueForm ? '#d63222' : '#e5ba68';
      ctx.strokeRect(x - 3, y - 3, w + 6, h + 6);
    }
    if (this.isTrueForm) ctx.filter = 'brightness(0.82) contrast(1.28) sepia(0.24) saturate(1.45) hue-rotate(326deg)';
    if (!this.sprite?.draw(ctx, x, y, w, h)) {
      ctx.fillStyle = this.isTrueForm ? '#572437' : this.isBoss ? '#ae8a69' : this.type === 'chavin' ? '#81c6bc' : '#d99672';
      ctx.fillRect(x + w * 0.1, y, w * 0.8, h);
      ctx.fillRect(x, y + h * 0.2, w, h * 0.6);
      if (this.isTrueForm) {
        ctx.fillStyle = '#e04b58';
        ctx.fillRect(x + w * 0.14, y + h * 0.78, w * 0.72, Math.max(3, h * 0.06));
      }
      ctx.fillStyle = '#172228';
      ctx.fillRect(x + w * 0.2, y + h * 0.3, w * 0.18, h * 0.15);
      ctx.fillRect(x + w * 0.62, y + h * 0.3, w * 0.18, h * 0.15);
      ctx.fillRect(x + w * 0.25, y + h * 0.75, w * 0.5, h * 0.1);
    }
    ctx.filter = 'none';
    if (this.isBoss) {
      ctx.fillStyle = this.aim ? '#ffffff' : this.isTrueForm ? '#ff2a16' : '#ffc76a';
      this.eyes.forEach((eye) => ctx.fillRect(eye.x - 3, eye.y - 2, 6, 4));
    }
    if (this.isBoss || this.maxHealth > 1) {
      ctx.fillStyle = '#25363a';
      ctx.fillRect(x, y + h + 6, w, 4);
      ctx.fillStyle = this.isTrueForm ? '#d63222' : '#f1ba62';
      ctx.fillRect(x, y + h + 6, w * this.health / this.maxHealth, 4);
    }
    if (this.flash > 0 || this.revealTime > 0) {
      ctx.globalAlpha = this.revealTime > 0 ? 0.2 + Math.sin(this.revealTime * 28) * 0.15 : 0.45;
      ctx.fillStyle = this.isTrueForm ? '#b72919' : '#fff0ad';
      ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
  }

  drawLaserWarning(ctx) {
    if (!this.aim || !this.alive) return;
    const box = this.aim.hitbox;
    ctx.save();
    ctx.strokeStyle = '#ff547d66';
    ctx.setLineDash([5, 12]);
    for (const eye of this.eyes) {
      ctx.beginPath();
      ctx.moveTo(eye.x, eye.y);
      ctx.lineTo(box.x + box.width / 2, box.y + box.height / 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// Los secuaces reutilizan daño y dibujo, pero se mueven fuera de la formación.
export class Minion extends Enemy {
  constructor(x, y, sprite, wave, layout) {
    super({ x: 0, y: 0 }, 'minion', sprite, 0, wave, layout);
    this.x = x;
    this.y = y;
    const progression = Math.max(0, wave - 7);
    this.sizeMultiplier = Math.min(2.2, 1 + progression * 0.08);
    const huacoHealth = Enemy.troopHealthForWave(wave);
    this.maxHealth = huacoHealth * minionHealthMultiplierForWave(wave);
    this.health = this.maxHealth;
    this.points = MINION_POINTS;
    this.bladeElapsed = 0;
    this.bladeInterval = null;
    this.resize(layout);
  }

  resize(layout) {
    super.resize(layout);
    this.width *= 0.7;
    this.height = this.width;
    this.speed = layout.mobile ? 90 : 110;
  }

  update(dt, player, width, height) {
    const targetX = player.hitbox.x + player.hitbox.width / 2;
    const dx = targetX - this.x - this.width / 2;
    this.x += Math.max(-this.speed * 0.7 * dt, Math.min(this.speed * 0.7 * dt, dx));
    this.x = Math.max(8, Math.min(width - this.width - 8, this.x));
    this.y += this.speed * dt;
    this.flash = Math.max(0, this.flash - dt);
    if (this.y > height) this.alive = false;
  }

  fireBlade(dt, isLastRow, player, random) {
    if (!this.alive || this.wave < EXTREME_WAVE || !isLastRow) return null;
    // El RNG de la partida es sembrado: servidor y cliente repiten los mismos intervalos.
    if (this.bladeInterval === null) this.bladeInterval = 3 + random() * 3;
    this.bladeElapsed += dt;
    if (this.bladeElapsed + 1e-9 < this.bladeInterval) return null;
    this.bladeElapsed = Math.max(0, this.bladeElapsed - this.bladeInterval);
    this.bladeInterval = 3 + random() * 3;
    return Projectile.shuriken(this.x + this.width / 2, this.y + this.height, player,
      this.laserSpeed * 1.1);
  }
}
