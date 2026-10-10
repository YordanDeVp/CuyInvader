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
    this.fiery = Boolean(options.fiery);
    this.damage = options.damage ?? 1;
    this.age = 0;
    // Velocidad angular en radianes por segundo; limita los giros bruscos.
    this.turnRate = options.turnRate ?? 0.72;
    this.blindspotRadius = options.blindspotRadius ?? 110;
    this.angle = options.angle ?? -Math.PI / 2;
    if (this.team === 'enemy') this.angle = Projectile.downwardAngle(this.angle);
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
    // Parte casi vertical y luego corrige poco a poco; evita apuntar con un giro instantáneo.
    return new Projectile(x, y, null, { team: 'enemy', target, speed, angle: Math.PI / 2 + spread });
  }

  // Nunca permite invertir la marcha ni quedarse volando horizontalmente.
  static downwardAngle(angle) {
    return Math.max(Math.PI / 12, Math.min(Math.PI * 11 / 12, angle));
  }

  update(dt, width, height) {
    const centerX = this.x + this.width / 2;
    const centerY = this.y + this.height / 2;
    this.age += dt;
    // Al llegar a la altura del cuy perdemos el objetivo de forma irreversible.
    if (this.target && (this.target.health <= 0 || centerY >= this.target.hitbox.y)) this.target = null;
    if (this.target) {
      const box = this.target.hitbox;
      const dx = box.x + box.width / 2 - centerX;
      const dy = box.y + box.height / 2 - centerY;
      // Punto ciego: dentro de este radio conserva el último rumbo y deja de seguir.
      if (Math.hypot(dx, dy) <= this.blindspotRadius) this.target = null;
    }
    if (this.target && this.target.health > 0) {
      // Solo corrige el rumbo durante la aproximación, siempre hacia abajo.
      const box = this.target.hitbox;
      const desired = Math.atan2(box.y + box.height / 2 - centerY, box.x + box.width / 2 - centerX);
      const difference = Math.atan2(Math.sin(desired - this.angle), Math.cos(desired - this.angle));
      this.angle += Math.max(-this.turnRate * dt, Math.min(this.turnRate * dt, difference));
      this.angle = Projectile.downwardAngle(this.angle);
    }
    this.setBounds(centerX + Math.cos(this.angle) * this.speed * dt, centerY + Math.sin(this.angle) * this.speed * dt);
    if (this.target && this.y + this.height / 2 >= this.target.hitbox.y) this.target = null;
    if (this.y + this.height < 0 || this.y > height || this.x + this.width < 0 || this.x > width) this.active = false;
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x + this.width / 2, this.y + this.height / 2);
    ctx.rotate(this.angle + Math.PI / 2);
    if (this.fiery) {
      // Fuego detrás del choclo; la estela es decorativa y no agranda la hitbox.
      const flicker = Math.floor((Math.sin(this.age * 45) + 1) * 3);
      ctx.shadowColor = '#ff6a18';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#ed3d16';
      ctx.fillRect(-9, -9, 18, 28 + flicker);
      ctx.fillRect(-5, 18, 10, 8 + flicker);
      ctx.fillStyle = '#ffb52e';
      ctx.fillRect(-7, -11, 14, 25);
      ctx.shadowBlur = 0;
      ctx.filter = 'sepia(0.55) saturate(2.4)';
    }
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
