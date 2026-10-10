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
    this.isHoming = this.team === 'enemy' && Boolean(this.target);
    this.homingDuration = options.homingDuration ?? 2;
    this.homingElapsed = 0;
    this.fiery = Boolean(options.fiery);
    this.damage = options.damage ?? 1;
    this.age = 0;
    // Velocidad angular en radianes por segundo; limita los giros bruscos.
    this.turnRate = options.turnRate ?? 0.72;
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
    // deltaTime acumula el permiso de rastreo; al agotarse los 2 s se bloquea el ángulo.
    const homingDt = this.isHoming
      ? Math.max(0, Math.min(dt, this.homingDuration - this.homingElapsed))
      : 0;
    if (this.isHoming && this.target && homingDt > 0) {
      // Limita el giro a la fracción del frame que aún queda dentro del plazo.
      const box = this.target.hitbox;
      const desired = Math.atan2(box.y + box.height / 2 - centerY, box.x + box.width / 2 - centerX);
      const difference = Math.atan2(Math.sin(desired - this.angle), Math.cos(desired - this.angle));
      this.angle += Math.max(-this.turnRate * homingDt, Math.min(this.turnRate * homingDt, difference));
      this.angle = Projectile.downwardAngle(this.angle);
    }
    this.homingElapsed += homingDt;
    if (this.isHoming && this.homingElapsed >= this.homingDuration) {
      this.isHoming = false;
      this.target = null;
    }
    // Después del límite no se vuelve a modificar el ángulo: sigue una línea recta.
    this.setBounds(centerX + Math.cos(this.angle) * this.speed * dt, centerY + Math.sin(this.angle) * this.speed * dt);
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
