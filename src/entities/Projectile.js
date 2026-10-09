export class Projectile {
  // La misma entidad admite choclos verticales y láseres dirigidos.
  constructor(centerX, y, image, options = {}) {
    this.team = options.team ?? 'player';
    this.speed = options.speed ?? 820;
    this.width = 8;
    this.height = 20;
    this.x = centerX - this.width / 2;
    this.y = y - this.height;
    this.vx = 0;
    this.vy = -this.speed;
    this.image = image;
    this.active = true;
    if (this.team === 'enemy') {
      const dx = options.targetX - centerX;
      const dy = options.targetY - y;
      const distance = Math.hypot(dx, dy) || 1;
      this.vx = dx / distance * this.speed;
      this.vy = dy / distance * this.speed;
      // La caja AABB engloba el trazo inclinado, no solo su centro.
      this.width = Math.abs(dx / distance) * 32 + Math.abs(dy / distance) * 8;
      this.height = Math.abs(dy / distance) * 32 + Math.abs(dx / distance) * 8;
      this.x = centerX - this.width / 2;
      this.y = y - this.height / 2;
    }
  }

  // Se apunta una vez; el láser no persigue al jugador después del disparo.
  static laser(x, y, targetX, targetY) {
    return new Projectile(x, y, null, { team: 'enemy', speed: 310, targetX, targetY });
  }

  update(deltaTime, canvasWidth, canvasHeight) {
    this.x += this.vx * deltaTime;
    this.y += this.vy * deltaTime;
    if (this.y + this.height < 0 || this.y > canvasHeight || this.x + this.width < 0 || this.x > canvasWidth) this.active = false;
  }

  draw(ctx) {
    if (this.team === 'enemy') {
      ctx.save();
      ctx.translate(this.x + this.width / 2, this.y + this.height / 2);
      ctx.rotate(Math.atan2(this.vy, this.vx) - Math.PI / 2);
      ctx.fillStyle = '#ff547d';
      ctx.fillRect(-4, -16, 8, 32);
      ctx.fillStyle = '#ffe8ee';
      ctx.fillRect(-1, -12, 2, 24);
      ctx.restore();
      return;
    }
    if (this.image?.complete && this.image.naturalWidth > 0) {
      ctx.drawImage(this.image, this.x, this.y, this.width, this.height);
      return;
    }
    // Choclo de respaldo mientras el PNG no exista o todavía esté cargando.
    ctx.fillStyle = '#f5cd69';
    ctx.fillRect(this.x + 1, this.y, 6, 16);
    ctx.fillStyle = '#fff0ad';
    ctx.fillRect(this.x + 2, this.y + 2, 2, 10);
    ctx.fillStyle = '#81dec3';
    ctx.fillRect(this.x, this.y + 12, 2, 8);
    ctx.fillRect(this.x + 6, this.y + 12, 2, 8);
  }
}
