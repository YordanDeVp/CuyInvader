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
