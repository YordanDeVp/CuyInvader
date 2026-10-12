import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, GameState } from '../src/Game.js';
import { Enemy } from '../src/entities/Enemy.js';
import { Player } from '../src/entities/Player.js';
import { Projectile } from '../src/entities/Projectile.js';

// Ejecuta la física real sin renderizado ni dependencias de navegador.
function session(wave = 4, width = 1200, height = 800) {
  const game = Object.create(Game.prototype);
  game.canvas = { width, height, focus() {} };
  game.assets = {};
  game.ui = { announcement: { textContent: '' } };
  game.input = { clear() {}, isDown: () => false, direction: 0 };
  game.syncHUD = () => {};
  game.syncUI = () => {};
  game.reset();
  game.wave = wave - 1;
  game.spawnWave();
  game.score = 4321;
  return game;
}

function advance(game, seconds, fps = 120) {
  for (let frame = 0; frame < seconds * fps; frame += 1) game.update(1 / fps);
}

test('las tres formaciones conservan el mismo límite inferior sin superponer filas', () => {
  for (const [width, height] of [[600, 660], [600, 1200], [1200, 800]]) {
    for (const wave of [1, 4, 7, 10, 20]) {
      const layout = Enemy.layout(wave, width, height);
      const bottoms = ['grid', 'triangle', 'crescent'].map((name) => {
        const slots = Enemy.slotsForFormation(name, layout);
        assert.equal(slots.length, layout.count);
        for (let i = 0; i < slots.length; i += 1) {
          for (let j = i + 1; j < slots.length; j += 1) {
            assert.ok(Math.abs(slots[i].x - slots[j].x) >= layout.size - 1e-6 ||
              Math.abs(slots[i].y - slots[j].y) >= layout.size - 1e-6, `${name}, oleada ${wave}: sprites superpuestos`);
          }
        }
        return Math.max(...slots.map((slot) => slot.y + layout.size / 2));
      });
      assert.ok(Math.max(...bottoms) - Math.min(...bottoms) < 1e-6, `Oleada ${wave}, ancho ${width}: ${bottoms}`);
    }
  }
});

test('al girar a un móvil bajo se conservan las tropas dentro de la zona segura', () => {
  const player = new Player(600, 420);
  for (const wave of [8, 12, 20]) {
    const original = Enemy.layout(wave, 1200, 800);
    const compact = Enemy.layout(wave, 600, 420, player.y, original.count);
    for (const form of ['grid', 'triangle', 'crescent']) {
      const slots = Enemy.slotsForFormation(form, compact);
      assert.equal(slots.length, original.count);
      assert.ok(Math.max(...slots.map(s => compact.startY + s.y + compact.size / 2)) <= player.y - 96 + 1e-6);
    }
  }
});

test('el cuy móvil usa el borde inferior del canvas: el gamepad ya está fuera', () => {
  const player = new Player(600, 660);
  assert.equal(660 - player.y - player.height, 28);
});

for (const width of [600, 1200]) {
  test(`cambiar de forma cerca del valle no termina la partida (${width}px)`, () => {
    const game = session(4, width, width === 600 ? 660 : 800);
    const localBottom = Math.max(...game.enemies.map((e) => e.offsetY + e.height / 2));
    game.formation.y = game.player.hitbox.y - localBottom - 20;
    game.enemySpeed = 0;
    game.player.invulnerability = Infinity;
    advance(game, 24);
    assert.equal(game.state, GameState.PLAYING, game.defeatReason);
    assert.equal(game.wave, 4);
    assert.equal(game.score, 4321);
  });
}

test('los rebotes frecuentes no provocan descensos repetidos en menos de tres segundos', () => {
  const formation = { x: 300, y: 36, halfWidth: 288, direction: 1 };
  for (let i = 0; i < 240; i += 1) Enemy.advanceFormation(formation, 500, 1 / 120, 600);
  assert.equal(formation.y, 36);
  for (let i = 0; i < 240; i += 1) Enemy.advanceFormation(formation, 500, 1 / 120, 600);
  assert.equal(formation.y, 44);
});

test('oleadas 4, 7 y 10 permiten al menos 20 segundos de maniobra en móvil y PC', () => {
  for (const width of [600, 1200]) {
    for (const wave of [4, 7, 10]) {
      const game = session(wave, width, width === 600 ? 660 : 800);
      game.player.invulnerability = Infinity; // Aísla el descenso de los impactos.
      advance(game, 20);
      assert.equal(game.state, GameState.PLAYING, `Oleada ${wave}, ${width}px: ${game.defeatReason}`);
    }
  }
});

test('el modo horizontal bloquea el Canvas, pausa la partida y no se reanuda solo al volver a vertical', (t) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let landscape = true;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    matchMedia: (query) => {
      assert.match(query, /orientation: landscape/);
      return { matches: landscape };
    },
  } });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  });

  const overlay = { hidden: true };
  const game = Object.create(Game.prototype);
  game.ui = { 'orientation-overlay': overlay };
  game.input = { clear() { this.cleared = true; } };
  game.state = GameState.PLAYING;
  game.pause = () => { game.state = GameState.PAUSED; };
  game.updateOrientation();
  assert.equal(game.orientationBlocked, true);
  assert.equal(overlay.hidden, false);
  assert.equal(game.input.cleared, true);
  assert.equal(game.state, GameState.PAUSED);

  landscape = false;
  game.updateOrientation();
  assert.equal(game.orientationBlocked, false);
  assert.equal(overlay.hidden, true);
  assert.equal(game.state, GameState.PAUSED);
});

test('una salva simultánea resta una vida; perder conserva puntaje y oleada', () => {
  const game = session(4);
  const hit = () => {
    const box = game.player.hitbox;
    game.enemyProjectiles = Array.from({ length: 10 }, () => Projectile.laser(box.x + box.width / 2, box.y + box.height / 2, game.player, 0));
    game.update(1 / 120);
  };
  hit();
  assert.equal(game.player.health, 2);
  assert.equal(game.state, GameState.PLAYING);
  hit();
  assert.equal(game.player.health, 2);
  game.player.invulnerability = 0;
  hit();
  assert.equal(game.player.health, 1);
  game.player.invulnerability = 0;
  hit();
  assert.equal(game.state, GameState.GAME_OVER);
  game.handleAction('Space');
  assert.equal(game.state, GameState.GAME_OVER);
  assert.equal(game.score, 4321);
  assert.equal(game.wave, 4);
});

test('las mejoras de las oleadas 4, 7 y 10 conservan la partida', () => {
  const game = session(1);
  const player = game.player;
  player.health = 2;
  for (let wave = 2; wave <= 12; wave += 1) {
    game.enemies.forEach((enemy) => { enemy.alive = false; });
    game.update(1 / 120);
    if ((wave - 1) % 3 === 0) {
      assert.equal(game.state, GameState.UPGRADE_MENU);
      game.applyUpgrade('damage');
    }
    assert.equal(game.state, GameState.PLAYING);
    assert.equal(game.wave, wave);
    assert.equal(game.player, player);
    assert.equal(player.health, 2);
    assert.equal(game.score, 4321);
  }
  assert.equal(player.projectileDamage, 4);
});

test('el descenso real hasta el valle sigue terminando la partida', () => {
  const game = session(4);
  game.formation.y = game.canvas.height;
  game.update(1 / 120);
  assert.equal(game.state, GameState.GAME_OVER);
  assert.match(game.defeatReason, /valle/);
});

test('offset de 8 px, huecos de 12 px y barrera de generación en todas las formas', () => {
  for (const [width, height] of [[600, 660], [600, 1200], [1200, 800]]) {
    for (const wave of [1, 4, 8, 12, 30]) {
      const game = session(wave, width, height);
      const layout = game.layout;
      assert.ok(layout.count <= Math.min(72, 36 + (wave - 1) * 4));
      assert.ok(Math.abs(Math.min(...game.enemies.map((enemy) => enemy.y)) - 8) < 1e-6);
      for (const name of ['grid', 'triangle', 'crescent']) {
        const slots = Enemy.slotsForFormation(name, layout);
        for (const slot of slots) {
          assert.ok(layout.startY + slot.y + layout.size / 2 <= game.player.y - layout.safetyMargin + 1e-6);
        }
        for (let i = 0; i < slots.length; i += 1) {
          for (let j = i + 1; j < slots.length; j += 1) {
            assert.ok(Math.abs(slots[i].x - slots[j].x) >= layout.size + 12 - 1e-6 ||
              Math.abs(slots[i].y - slots[j].y) >= layout.size + 12 - 1e-6, `${wave}: ${name} no deja 12 px`);
          }
        }
      }
    }
  }
});

test('rotar a móvil mantiene índices y tropas dentro de la barrera de generación', () => {
  const desktop = Enemy.layout(12, 1200, 800);
  const player = new Player(600, 660);
  const mobile = Enemy.layout(12, 600, 660, player.y, desktop.count);
  for (const name of ['grid', 'triangle', 'crescent']) {
    const slots = Enemy.slotsForFormation(name, mobile);
    assert.equal(slots.length, desktop.count);
    assert.ok(Math.max(...slots.map((s) => mobile.startY + s.y + mobile.size / 2)) <= player.y - mobile.safetyMargin + 1e-6);
  }
});

test('el láser gira suavemente hasta 1500 ms y no vuelve a consultar el objetivo', () => {
  for (const fps of [30, 60, 120]) {
    const target = { hitbox: { x: 1000, y: 9000, width: 50, height: 50 } };
    const laser = Projectile.laser(0, 0, target);
    for (let frame = 0; frame < fps * 1.5; frame += 1) {
      const before = laser.angle;
      laser.update(1 / fps, 10000, 10000);
      assert.ok(Math.abs(laser.angle - before) <= laser.turnRate / fps + 1e-9);
    }
    assert.equal(laser.isHoming, false);
    assert.ok(Math.abs(laser.homingElapsed - 1.5) < 1e-9);
    const angle = laser.angle;
    Object.defineProperty(target, 'hitbox', { get() { throw new Error('Rastreo fuera de plazo'); } });
    laser.update(1, 10000, 10000);
    assert.equal(laser.angle, angle);
  }
  const laser = Projectile.laser(100, 100, { hitbox: { x: 1000, y: 2000, width: 10, height: 10 } });
  laser.update(1.49, 10000, 10000);
  const before = laser.angle;
  laser.update(0.05, 10000, 10000);
  assert.equal(laser.isHoming, false);
  assert.ok(Math.abs(laser.angle - before) <= laser.turnRate * 0.01 + 1e-9);
});

test('burbujas solo desde oleada 8, reloj persistente y pausas sin consumir tiempo', (t) => {
  t.mock.method(Math, 'random', () => 0.25);
  const game = session(7);
  game.updateEndgameDrops(60);
  assert.equal(game.powerUps.length, 0);
  assert.equal(game.dropInterval, null);
  game.spawnWave();
  assert.equal(game.dropInterval, 11.25);
  game.updateEndgameDrops(10);
  game.state = GameState.PAUSED;
  game.update(60);
  game.updateEndgameDrops(60);
  assert.equal(game.dropElapsed, 10);
  game.state = GameState.UPGRADE_MENU;
  game.updateEndgameDrops(60);
  assert.equal(game.dropElapsed, 10);
  game.state = GameState.PLAYING;
  game.spawnWave();
  assert.equal(game.dropElapsed, 10);
  game.updateEndgameDrops(1.25);
  assert.equal(game.powerUps.length, 1);
  assert.equal(game.powerUps[0].kind, 'jalapeno');
  assert.equal(game.powerUps[0].y, -52);
  assert.equal(game.powerUps[0].bubble, true);
  game.reset();
  assert.equal(game.dropElapsed, 0);
  assert.equal(game.dropInterval, null);
});

test('probabilidad 50/50 e intervalos aleatorios dentro de 10–15 segundos', (t) => {
  const game = session(8);
  for (const [value, kind] of [[0, 'jalapeno'], [0.499, 'jalapeno'], [0.5, 'missile'], [0.999, 'missile']]) {
    t.mock.method(Math, 'random', () => value);
    game.dropInterval = 10;
    game.dropElapsed = 0;
    game.updateEndgameDrops(10);
    assert.equal(game.powerUps.at(-1).kind, kind);
    assert.ok(game.dropInterval >= 10 && game.dropInterval <= 15);
  }
});

test('dos inventarios independientes: Q y E consumen solo su poder', () => {
  const game = session(8);
  const box = game.player.hitbox;
  game.spawnPowerUp('missile', box.x + box.width / 2, box.y);
  game.updatePowerUps(0);
  assert.equal(game.player.chocloMisilCount, 1);
  assert.equal(game.projectiles.length, 0);
  game.spawnPowerUp('jalapeno', box.x + box.width / 2, box.y);
  game.updatePowerUps(0);
  assert.equal(game.player.jalapenoCount, 1);
  assert.equal(game.powerUps.length, 0);
  game.handleAction('KeyE');
  assert.equal(game.player.chocloMisilCount, 0);
  assert.equal(game.player.jalapenoCount, 1);
  assert.equal(game.projectiles.length, 1);
  assert.equal(game.projectiles[0].isMissile, true);
  assert.ok(game.projectiles[0].width >= 36);
  game.handleAction('KeyE');
  assert.equal(game.projectiles.length, 1);
  game.handleAction('KeyQ');
  assert.equal(game.player.jalapenoCount, 0);
  assert.equal(game.player.powerTime, 8);
  assert.equal(game.player.shoot().length, 3);
});

test('cada poder admite 3 cargas; cada drop excedente otorga exactamente 100 puntos', () => {
  const game = session(8);
  const score = game.score;
  const box = game.player.hitbox;
  for (const kind of ['jalapeno', 'missile']) {
    for (let i = 0; i < 5; i += 1) game.spawnPowerUp(kind, box.x + box.width / 2, box.y);
  }
  game.updatePowerUps(0);
  assert.equal(game.player.jalapenoCount, 3);
  assert.equal(game.player.chocloMisilCount, 3);
  assert.equal(game.score, score + 400);
  assert.equal(game.powerUps.length, 0);
  game.updatePowerUps(0);
  assert.equal(game.score, score + 400);
  for (let i = 0; i < 5; i += 1) game.handleAction('KeyE');
  assert.equal(game.projectiles.length, 3);
  assert.equal(game.player.chocloMisilCount, 0);
  assert.equal(game.player.jalapenoCount, 3);
});

test('desde la oleada 7 aparecen dos jefes y sus láseres disparan cada siete segundos', () => {
  assert.equal(Enemy.guardianCount(6), 5);
  for (const wave of [7, 10, 20]) {
    const game = session(wave);
    assert.equal(game.layout.bosses, 2);
    assert.equal(game.enemies.filter((enemy) => enemy.isBoss).length, 2);
    game.updateLasers(6);
    assert.equal(game.enemyProjectiles.length, 0);
    game.updateLasers(1);
    assert.equal(game.enemyProjectiles.length, 4);
    assert.equal(game.laserElapsed, 0);
  }
  const early = session(6);
  early.updateLasers(7);
  assert.equal(early.enemyProjectiles.length, 0);
  early.updateLasers(3);
  assert.equal(early.enemyProjectiles.length, 10);
});

test('cada jefe de oleada 7+ invoca exactamente dos secuaces con 2x HP de huaco', () => {
  for (const wave of [7, 10]) {
    const game = session(wave);
    const bosses = game.enemies.filter((enemy) => enemy.isBoss);
    const huaco = game.enemies.find((enemy) => enemy.type === 'moche');
    for (const boss of bosses) boss.update(2.99, game.formation);
    game.updateSummons();
    assert.equal(game.minions.length, 0);
    for (const boss of bosses) boss.update(0.01, game.formation);
    game.updateSummons();
    assert.equal(game.minions.length, 4);
    assert.ok(game.minions.every((minion) => minion.maxHealth === huaco.maxHealth * 2));
    assert.ok(game.minions.every((minion) => minion.width < huaco.width));
    game.updateSummons();
    assert.equal(game.minions.length, 4);
    for (const boss of bosses) boss.update(3, game.formation);
    game.updateSummons();
    assert.equal(game.minions.length, 8);
    bosses[0].alive = false;
    for (const boss of bosses) boss.update(3, game.formation);
    game.updateSummons();
    assert.equal(game.minions.length, 10);
  }
});

test('pausa y jalapeño activo no gastan cargas; las oleadas conservan ambas reservas', () => {
  const game = session(8);
  game.player.collectPower('jalapeno');
  game.player.collectPower('jalapeno');
  game.player.collectPower('missile');
  game.state = GameState.PAUSED;
  game.handleAction('KeyQ'); game.handleAction('KeyE');
  assert.equal(game.player.jalapenoCount, 2);
  assert.equal(game.player.chocloMisilCount, 1);
  game.state = GameState.PLAYING;
  game.handleAction('KeyQ'); game.handleAction('KeyQ');
  assert.equal(game.player.jalapenoCount, 1);
  assert.equal(game.player.powerTime, 8);
  game.spawnWave();
  assert.equal(game.player.jalapenoCount, 1);
  assert.equal(game.player.chocloMisilCount, 1);
  game.player.update(8, game.input, game.canvas.width);
  game.handleAction('KeyQ');
  assert.equal(game.player.jalapenoCount, 0);
  assert.equal(game.player.powerTime, 8);
  game.reset();
  assert.equal(game.player.jalapenoCount, 0);
  assert.equal(game.player.chocloMisilCount, 0);
});

test('el impacto de un misil elimina el bloque 3×3 una sola vez y deja fuera al resto', () => {
  const game = session(8);
  game.enemySpeed = 0;
  const layout = { ...game.layout, size: 24 };
  game.enemies = [];
  for (let row = -1; row <= 1; row += 1) {
    for (let col = -1; col <= 1; col += 1) {
      game.enemies.push(new Enemy({ x: col * 80, y: 200 + row * 80 }, 'chavin', null, 0, 8, layout));
    }
  }
  const outside = new Enemy({ x: 160, y: 200 }, 'moche', null, 0, 8, layout);
  game.enemies.push(outside);
  game.enemies.forEach((enemy) => enemy.update(0, game.formation));
  const center = game.enemies[4];
  const missile = game.player.shootMissile(240, 240);
  missile.setBounds(center.x + center.width / 2, center.y + center.height / 2);
  game.projectiles.push(missile);
  game.update(0);
  assert.deepEqual(game.enemies, [outside]);
  assert.equal(outside.health, outside.maxHealth);
  assert.equal(game.score, 4321 + 9 * 30);
  assert.equal(game.explosions.length, 1);
  assert.equal(game.projectiles.length, 0);
  game.update(0);
  assert.equal(game.score, 4321 + 9 * 30);
});

test('AoE respeta revelación del impostor y cuenta guardianes solo al morir', () => {
  const game = session(8);
  const boss = game.enemies.find((enemy) => enemy.isImpostor);
  game.guardiansDefeated = 4;
  const missile = game.player.shootMissile(200, 200);
  missile.damage = 1000;
  game.detonateMissile(missile, boss, [boss]);
  assert.equal(boss.isTrueForm, true);
  assert.equal(boss.alive, true);
  assert.equal(game.guardiansDefeated, 4);
  assert.equal(game.score, 4321);
  boss.revealTime = 0;
  game.detonateMissile(missile, boss, [boss]);
  assert.equal(game.guardiansDefeated, 5);
  assert.equal(game.score, 4921);
  assert.equal(game.powerUps.length, 1);
  assert.equal(game.powerUps[0].kind, 'jalapeno');
});
