import { Projectile } from './Projectile.js';

export class Player {
  // El cuy y su ametralladora se desplazan como una sola entidad.
  constructor(canvasWidth, canvasHeight, image, projectileImage, pilotImage) {
    this.x = canvasWidth / 2;
    this.powerTime = 0;
    this.speedMultiplier = 1;
    this.projectileDamage = 1;
    this.resize(canvasWidth, canvasHeight);
    this.x = (canvasWidth - this.width) / 2;
    this.cooldown = 0;
    this.shotInterval = 0.10;
    this.muzzleFlash = 0;
    this.health = 3;
    this.invulnerability = 0;
    this.image = image;
    this.pilotImage = pilotImage;
    this.projectileImage = projectileImage;
  }

  // La hitbox excluye la punta del cañón para que esquivar resulte justo.
  get hitbox() {
    const scale = this.width / 96;
    return { x: this.x + 10 * scale, y: this.y + 18 * scale, width: 76 * scale, height: 62 * scale };
  }

  // El gamepad está fuera del canvas: dejamos solo el margen del vehículo.
  resize(width, height, bottomSpace = 28) {
    this.width = width <= 640 ? 72 : 96;
    this.height = this.width * 86 / 96;
    this.y = height - this.height - bottomSpace;
    this.speed = (width <= 640 ? 330 : 480) * this.speedMultiplier;
    this.x = Math.max(12, Math.min(width - this.width - 12, this.x));
  }

  activatePower() {
    this.powerTime = 8;
    this.cooldown = 0;
  }

  upgradeSpeed() {
    this.speedMultiplier *= 1.2;
    this.speed = (this.width <= 72 ? 330 : 480) * this.speedMultiplier;
  }

  update(deltaTime, input, canvasWidth) {
    this.x += input.direction * this.speed * deltaTime;
    this.x = Math.max(16, Math.min(canvasWidth - this.width - 16, this.x));
    this.cooldown = Math.max(0, this.cooldown - deltaTime);
    this.muzzleFlash = Math.max(0, this.muzzleFlash - deltaTime);
    this.invulnerability = Math.max(0, this.invulnerability - deltaTime);
    this.powerTime = Math.max(0, this.powerTime - deltaTime);
  }

  // Los choclos salen de la boca de la ametralladora, a la derecha del asiento.
  shoot() {
    if (this.cooldown > 1e-9) return [];
    this.cooldown = this.powerTime > 0 ? 0.065 : this.shotInterval;
    this.muzzleFlash = 0.055;
    const angles = this.powerTime > 0 ? [-0.2, 0, 0.2] : [0];
    return angles.map((offset) => new Projectile(this.x + this.width * 0.75, this.y + 2, this.projectileImage, {
      angle: -Math.PI / 2 + offset, fiery: this.powerTime > 0,
      damage: this.projectileDamage,
    }));
  }

  // El ataque especial conserva el daño mejorado y usa una hitbox mayor.
  shootMissile(blastWidth, blastHeight) {
    this.muzzleFlash = 0.12;
    return new Projectile(this.x + this.width * 0.75, this.y - 20, this.projectileImage, {
      isMissile: true, speed: 580, damage: this.projectileDamage * 4,
      blastWidth, blastHeight,
    });
  }

  // Una ráfaga de dos ojos no puede quitar varias vidas de un solo golpe.
  takeHit() {
    if (this.invulnerability > 0 || this.health <= 0) return false;
    this.health -= 1;
    this.invulnerability = 1.5;
    return true;
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(Math.round(this.x), Math.round(this.y));
    ctx.scale(this.width / 96, this.width / 96);
    if (this.invulnerability > 0 && Math.floor(this.invulnerability * 12) % 2 === 0) ctx.globalAlpha = 0.4;
    const x = 0;
    const y = 0;
    if (this.image?.draw(ctx, x, y, 96, 86)) {
      // Admite un sprite completo del vehículo si se añade al atlas.
    } else {
      // Plataforma, orugas, asiento y soporte de la ametralladora.
      ctx.fillStyle = '#0a1119';
      ctx.fillRect(x + 2, y + 72, 92, 14);
      ctx.fillStyle = '#668783';
      ctx.fillRect(x + 8, y + 68, 80, 10);
      for (let wheel = 0; wheel < 6; wheel += 1) ctx.fillRect(x + 8 + wheel * 14, y + 79, 8, 4);
      ctx.fillStyle = '#354e51';
      ctx.fillRect(x + 10, y + 24, 8, 40);
      ctx.fillRect(x + 14, y + 56, 42, 10);
      ctx.fillRect(x + 27, y + 62, 8, 9);
      ctx.fillRect(x + 64, y + 49, 9, 23);
      if (this.pilotImage?.draw(ctx, x + 12, y + 1, 44, 61)) {
        // El cuy de la hoja se sienta sobre la plataforma de la ametralladora.
      } else {
        // Cuy sentado: cabeza, cuerpo y patas apoyadas en la plataforma.
        ctx.fillStyle = '#bb7548';
        ctx.fillRect(x + 17, y + 12, 10, 12);
        ctx.fillRect(x + 45, y + 12, 10, 12);
        ctx.fillStyle = '#eee0b8';
        ctx.fillRect(x + 17, y + 21, 39, 24);
        ctx.fillRect(x + 21, y + 41, 30, 18);
        ctx.fillStyle = '#c98d56';
        ctx.fillRect(x + 43, y + 21, 13, 14);
        ctx.fillRect(x + 21, y + 58, 14, 7);
        ctx.fillRect(x + 41, y + 56, 12, 7);
        ctx.fillStyle = '#172228';
        ctx.fillRect(x + 25, y + 28, 5, 5);
        ctx.fillRect(x + 43, y + 28, 5, 5);
        ctx.fillStyle = '#d88376';
        ctx.fillRect(x + 34, y + 36, 6, 4);
      }
      // Tres tubos, camisa metálica y cinta de choclos alimentando el arma.
      const recoil = this.muzzleFlash > 0 ? 2 : 0;
      ctx.fillStyle = '#344c54';
      ctx.fillRect(x + 52, y + 38 + recoil, 34, 19);
      ctx.fillStyle = '#9bb7af';
      ctx.fillRect(x + 63, y + 6 + recoil, 5, 36);
      ctx.fillRect(x + 70, y + 6 + recoil, 5, 36);
      ctx.fillRect(x + 77, y + 6 + recoil, 5, 36);
      ctx.fillStyle = '#567a7c';
      ctx.fillRect(x + 61, y + 1 + recoil, 23, 8);
      ctx.fillRect(x + 60, y + 27 + recoil, 24, 7);
      ctx.fillStyle = '#f1ba62';
      for (let round = 0; round < 4; round += 1) ctx.fillRect(x + 84, y + 48 + round * 6, 8, 4);
      ctx.fillStyle = '#eee0b8';
      ctx.fillRect(x + 47, y + 44, 12, 7);
    }
    if (this.muzzleFlash > 0) {
      ctx.fillStyle = '#f1ba62';
      ctx.fillRect(x + 66, y - 12, 12, 14);
      ctx.fillStyle = '#fff4c0';
      ctx.fillRect(x + 70, y - 18, 4, 18);
    }
    if (this.powerTime > 0) {
      ctx.strokeStyle = '#ff794b';
      ctx.lineWidth = 2;
      ctx.strokeRect(-3, -3, 102, 92);
    }
    ctx.restore();
  }
}
