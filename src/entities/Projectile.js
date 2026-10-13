export class Projectile {
  constructor(centerX, y, sprite, options = {}) {
    this.team = options.team ?? 'player';
    this.kind = options.kind ?? 'normal';
    this.speed = options.speed ?? 820;
    this.width = 12;
    this.height = 24;
    this.x = centerX - this.width / 2;
    this.y = y - this.height / 2;
    this.sprite = sprite;
    this.target = options.target;
    this.isHoming = this.team === 'enemy' && Boolean(this.target);
    this.homingDuration = Math.min(options.homingDuration ?? 1.5, 1.5);
    this.homingElapsed = 0;
    this.fiery = Boolean(options.fiery);
    this.isMissile = Boolean(options.isMissile);
    this.blastWidth = options.blastWidth ?? 0;
    this.blastHeight = options.blastHeight ?? 0;
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
    if (this.kind === 'shuriken') {
      // Caja cuadrada constante: la rotación del dibujo no cambia las colisiones.
      this.width = this.height = 20;
      this.x = centerX - 10;
      this.y = centerY - 10;
      return;
    }
    const thickness = this.isMissile ? 36 : this.team === 'enemy' ? 10 : 12;
    const length = this.isMissile ? 72 : 24;
    this.width = Math.abs(Math.cos(this.angle)) * length + Math.abs(Math.sin(this.angle)) * thickness;
    this.height = Math.abs(Math.sin(this.angle)) * length + Math.abs(Math.cos(this.angle)) * thickness;
    this.x = centerX - this.width / 2;
    this.y = centerY - this.height / 2;
  }

  static laser(x, y, target, speed = 210, spread = 0) {
    // Parte casi vertical y luego corrige poco a poco; evita apuntar con un giro instantáneo.
    return new Projectile(x, y, null, { team: 'enemy', target, speed, angle: Math.PI / 2 + spread });
  }

  static shuriken(x, y, player, speed = 230) {
    const box = player.hitbox;
    // Apunta una sola vez al dispararse; la cuchilla nunca persigue al cuy.
    const angle = Math.atan2(box.y + box.height / 2 - y, box.x + box.width / 2 - x);
    return new Projectile(x, y, null, { team: 'enemy', kind: 'shuriken', speed, angle });
  }

  // Nunca permite invertir la marcha ni quedarse volando horizontalmente.
  static downwardAngle(angle) {
    return Math.max(Math.PI / 12, Math.min(Math.PI * 11 / 12, angle));
  }

  update(dt, width, height) {
    const centerX = this.x + this.width / 2;
    const centerY = this.y + this.height / 2;
    this.age += dt;
    // dt está en segundos: rastreo durante 1,5 s (1500 ms), incluso si un
    // frame cruza el límite. Después no vuelve a consultar al jugador.
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
    if (this.isHoming && this.homingElapsed + 1e-9 >= this.homingDuration) {
      this.homingElapsed = this.homingDuration;
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
    if (this.kind === 'shuriken') {
      ctx.rotate(this.age * 12);
      ctx.fillStyle = '#9bdde3';
      ctx.fillRect(-2, -10, 4, 20);
      ctx.fillRect(-10, -2, 20, 4);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#eaf9ff';
      ctx.fillRect(-2, -7, 4, 14);
      ctx.fillRect(-7, -2, 14, 4);
      ctx.fillStyle = '#25363a';
      ctx.fillRect(-2, -2, 4, 4);
      ctx.restore();
      return;
    }
    ctx.rotate(this.angle + Math.PI / 2);
    if (this.isMissile) {
      // El mismo sprite de choclo se amplía; el fallback también escala.
      ctx.scale(3, 3);
      ctx.fillStyle = '#81dec3';
      ctx.fillRect(-3, 12, 6, 8 + Math.sin(this.age * 40) * 2);
    }
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
