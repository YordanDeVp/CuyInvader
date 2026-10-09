export class Projectile {
  constructor(centerX, y, sprite, options = {}) {
    this.team = options.team ?? 'player';
    this.speed = options.speed ?? 820;
    this.width = 12;
    this.height = 24;
    this.x = centerX - this.width / 2;
    this.y = y - this.height / 2;
    this.sprite = sprite;
    this.target = options.target;
    this.turnRate = options.turnRate ?? 1.25;
    this.angle = options.angle ?? -Math.PI / 2;
    this.active = true;
    this.setBounds(centerX, y);
  }

  // La caja de colisión acompaña el giro del trazo, también en disparos diagonales.
  setBounds(centerX, centerY) {
    const thickness = this.team === 'enemy' ? 10 : 12;
    this.width = Math.abs(Math.cos(this.angle)) * 24 + Math.abs(Math.sin(this.angle)) * thickness;
    this.height = Math.abs(Math.sin(this.angle)) * 24 + Math.abs(Math.cos(this.angle)) * thickness;
    this.x = centerX - this.width / 2;
    this.y = centerY - this.height / 2;
  }

  static laser(x, y, target, speed = 210, spread = 0) {
    const box = target.hitbox;
    const angle = Math.atan2(box.y + box.height / 2 - y, box.x + box.width / 2 - x) + spread;
    return new Projectile(x, y, null, { team: 'enemy', target, speed, angle });
  }

  update(dt, width, height) {
    const centerX = this.x + this.width / 2;
    const centerY = this.y + this.height / 2;
    if (this.target && this.target.health > 0) {
      // Homing continuo en ambos ejes; limitar el giro permite esquivar el láser.
      const box = this.target.hitbox;
      const desired = Math.atan2(box.y + box.height / 2 - centerY, box.x + box.width / 2 - centerX);
      const difference = Math.atan2(Math.sin(desired - this.angle), Math.cos(desired - this.angle));
      this.angle += Math.max(-this.turnRate * dt, Math.min(this.turnRate * dt, difference));
    }
    this.setBounds(centerX + Math.cos(this.angle) * this.speed * dt, centerY + Math.sin(this.angle) * this.speed * dt);
    if (this.y + this.height < 0 || this.y > height || this.x + this.width < 0 || this.x > width) this.active = false;
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x + this.width / 2, this.y + this.height / 2);
    ctx.rotate(this.angle + Math.PI / 2);
    if (this.team === 'enemy') {
      ctx.fillStyle = '#ff547d';
      ctx.fillRect(-5, -12, 10, 24);
      ctx.fillStyle = '#ffe8ee';
      ctx.fillRect(-2, -10, 4, 20);
    } else if (!this.sprite?.draw(ctx, -6, -12, 12, 24)) {
      ctx.fillStyle = '#f5cd69';
      ctx.fillRect(-4, -12, 8, 19);
      ctx.fillStyle = '#fff0ad';
      ctx.fillRect(-2, -10, 3, 12);
      ctx.fillStyle = '#81dec3';
      ctx.fillRect(-6, 3, 3, 9);
      ctx.fillRect(3, 3, 3, 9);
    }
    ctx.restore();
  }
}
