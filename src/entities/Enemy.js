import { Projectile } from './Projectile.js';

export class Enemy {
  constructor(slot, type, image, index) {
    this.isBoss = type === 'boss';
    this.width = this.isBoss ? 72 : 40;
    this.height = this.isBoss ? 60 : 34;
    this.type = type;
    this.image = image;
    this.index = index;
    this.alive = true;
    this.maxHealth = this.isBoss ? 10 : 1;
    this.health = this.maxHealth;
    this.points = this.isBoss ? 250 : type === 'chavin' ? 30 : 20;
    this.flash = 0;
    this.aim = null;
    this.setSlot(slot, true);
  }

  static speedForWave(wave) {
    return 64 * 1.1 ** (wave - 1);
  }

  // Se conservan los 36 puestos originales, aunque hayan caído algunos enemigos.
  static slotsForFormation(name) {
    const slots = [];
    if (name === 'triangle') {
      for (let row = 1; row <= 8; row += 1) {
        for (let column = 0; column < row; column += 1) {
          slots.push({ x: (column - (row - 1) / 2) * 90, y: 80 + (row - 1) * 44 });
        }
      }
    } else if (name === 'crescent') {
      for (let row = 0; row < 3; row += 1) {
        for (let column = 0; column < 12; column += 1) {
          const unit = (column - 5.5) / 5.5;
          slots.push({ x: (column - 5.5) * 64, y: 98 + row * 52 + (1 - Math.sqrt(1 - unit * unit)) * 210 });
        }
      }
    } else {
      for (let row = 0; row < 4; row += 1) {
        for (let column = 0; column < 9; column += 1) slots.push({ x: (column - 4) * 78, y: 108 + row * 72 });
      }
    }
    return slots;
  }

  // Una envolvente común evita saltos laterales al ensanchar la formación.
  static advanceFormation(formation, speed, deltaTime, canvasWidth) {
    const left = 24 + formation.halfWidth;
    const right = canvasWidth - 24 - formation.halfWidth;
    const available = formation.direction > 0 ? right - formation.x : formation.x - left;
    const distance = speed * deltaTime;
    formation.x += formation.direction * Math.min(distance, Math.max(0, available));
    if (distance >= available) {
      formation.direction *= -1;
      formation.y += 12;
    }
  }

  // La interpolación usa coordenadas locales: el grupo sigue avanzando al transformarse.
  setSlot(slot, immediate = false) {
    this.targetX = slot.x - this.width / 2;
    this.targetY = slot.y;
    if (immediate) {
      this.offsetX = this.targetX;
      this.offsetY = this.targetY;
    }
  }

  update(deltaTime, formation) {
    const blend = 1 - Math.exp(-4 * deltaTime);
    this.offsetX += (this.targetX - this.offsetX) * blend;
    this.offsetY += (this.targetY - this.offsetY) * blend;
    this.x = formation.x + this.offsetX;
    this.y = formation.y + this.offsetY;
    this.flash = Math.max(0, this.flash - deltaTime);
  }

  takeHit() {
    this.health -= 1;
    this.flash = 0.08;
    this.alive = this.health > 0;
  }

  // La marca permanece fija durante el segundo de aviso para permitir esquivarla.
  prepareLaser(player) {
    if (this.isBoss && !this.aim) {
      const box = player.hitbox;
      this.aim = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
  }

  get eyes() {
    return [this.x + 23, this.x + 49].map((x) => ({ x, y: this.y + 27 }));
  }

  fireLasers() {
    if (!this.isBoss || !this.alive || !this.aim) return [];
    const lasers = this.eyes.map((eye) => Projectile.laser(eye.x, eye.y, this.aim.x, this.aim.y));
    this.aim = null;
    return lasers;
  }

  draw(ctx) {
    const x = Math.round(this.x);
    const y = Math.round(this.y);
    if (this.image?.complete && this.image.naturalWidth > 0) {
      ctx.drawImage(this.image, x, y, this.width, this.height);
    } else if (this.isBoss) {
      // Guardianes de piedra con tocado dorado y dos ojos de energía.
      ctx.fillStyle = '#ae8a69';
      ctx.fillRect(x + 8, y + 12, 56, 42);
      ctx.fillRect(x, y + 22, 8, 24);
      ctx.fillRect(x + 64, y + 22, 8, 24);
      ctx.fillStyle = '#e5ba68';
      ctx.fillRect(x + 4, y + 6, 64, 10);
      for (let i = 0; i < 5; i += 1) ctx.fillRect(x + 8 + i * 12, y, 8, 8);
      ctx.fillRect(x + 31, y + 28, 10, 17);
      ctx.fillStyle = '#233039';
      ctx.fillRect(x + 16, y + 21, 15, 12);
      ctx.fillRect(x + 42, y + 21, 15, 12);
      ctx.fillRect(x + 21, y + 46, 30, 6);
      ctx.fillStyle = '#e5ba68';
      ctx.fillRect(x + 23, y + 46, 5, 12);
      ctx.fillRect(x + 44, y + 46, 5, 12);
    } else {
      ctx.fillStyle = this.type === 'chavin' ? '#81c6bc' : '#d99672';
      ctx.fillRect(x + 6, y + 4, 28, 26);
      ctx.fillRect(x, y + 10, 6, 16);
      ctx.fillRect(x + 34, y + 10, 6, 16);
      ctx.fillRect(x + 10, y + 30, 20, 4);
      ctx.fillStyle = this.type === 'chavin' ? '#bbe8d1' : '#f3c18a';
      ctx.fillRect(x + 4, y, 32, 6);
      ctx.fillRect(x + 18, y + 13, 4, 11);
      ctx.fillStyle = '#172228';
      ctx.fillRect(x + 10, y + 12, 6, 5);
      ctx.fillRect(x + 24, y + 12, 6, 5);
      ctx.fillRect(x + 12, y + 26, 16, 3);
    }
    if (this.isBoss) {
      ctx.fillStyle = this.aim ? '#fff0ef' : '#ff547d';
      this.eyes.forEach((eye) => ctx.fillRect(eye.x - 4, eye.y - 3, 8, 6));
      ctx.fillStyle = '#25363a';
      ctx.fillRect(x + 7, y + this.height + 4, 58, 4);
      ctx.fillStyle = '#f1ba62';
      ctx.fillRect(x + 7, y + this.height + 4, 58 * this.health / this.maxHealth, 4);
    }
    if (this.flash > 0) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#fff0ad';
      ctx.fillRect(x, y, this.width, this.height);
      ctx.restore();
    }
  }

  // Guías de aviso antes de los láseres; no infligen daño.
  drawLaserWarning(ctx) {
    if (!this.aim || !this.alive) return;
    ctx.save();
    ctx.strokeStyle = '#ff547d66';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 12]);
    for (const eye of this.eyes) {
      ctx.beginPath();
      ctx.moveTo(eye.x, eye.y);
      ctx.lineTo(this.aim.x, this.aim.y);
      ctx.stroke();
    }
    ctx.fillStyle = '#ff547d';
    ctx.fillRect(this.aim.x - 14, this.aim.y, 28, 2);
    ctx.fillRect(this.aim.x, this.aim.y - 14, 2, 28);
    ctx.restore();
  }
}
