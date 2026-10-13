import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp, createGameTicket } from '../server.js';
import { createSimulation, validateReplay } from '../src/Simulation.js';
import { MAX_RUN_STEPS } from '../src/RunReplay.js';
import { verifyRun } from '../backend/verify-run.mjs';
import { request } from '../src/api.js';
import { Game } from '../src/Game.js';
import { Enemy } from '../src/entities/Enemy.js';

const SECRET = 'replay-tests-only-secret-at-least-32-bytes';

// Solo entradas permitidas; nunca cambia HP, posición, puntuación ni oleada.
function play(token, width, height, { resize = false } = {}) {
  const game = createSimulation(token, width, height);
  for (let tick = 0; tick < 36000 && game.state !== 'over'; tick += 1) {
    if (resize && tick === 300) { game.resizeWorld(600, 500); game.state = 'playing'; }
    if (game.state === 'upgrade_menu') game.applyUpgrade('damage');
    game.input.fire = game.wave < 3;
    if (game.wave < 3) {
      const aim = game.player.x + game.player.width * 0.75;
      const enemy = [...game.enemies].sort((a,b) => Math.abs(a.x+a.width/2-aim)-Math.abs(b.x+b.width/2-aim))[0];
      const desired = enemy.x+enemy.width/2+game.formation.direction*game.enemySpeed*(game.player.y-enemy.y)/820;
      const dx = desired-aim;
      game.input.direction = Math.abs(dx) > enemy.width*0.15 ? Math.sign(dx) : 0;
    } else {
      const box = game.player.hitbox;
      const laser = [...game.enemyProjectiles].sort((a,b) => Math.abs(a.y-box.y)-Math.abs(b.y-box.y))[0];
      const dx = laser ? laser.x+laser.width/2-(box.x+box.width/2) : 0;
      game.input.direction = Math.abs(dx)>3 ? Math.sign(dx) : 0;
    }
    game.update(1/120);
  }
  assert.equal(game.state, 'over');
  return { score: game.score, wave: game.wave, replay: game.recorder.export() };
}

function database() {
  const rows = new Map();
  return { rows, from() {
    let entry, id;
    const query = {};
    for (const method of ['select','order','limit','single','maybeSingle']) query[method] = () => query;
    query.eq = (_field,value) => { id=value; return query; };
    query.insert = (value) => { entry=value; return query; };
    query.abortSignal = async () => {
      if (entry) {
        if (rows.has(entry.run_id)) return { error: { code:'23505' } };
        const row={...entry,id:'test-row',created_at:new Date().toISOString()}; rows.set(entry.run_id,row);
        return {data:row};
      }
      return {data:id ? rows.get(id)??null : [...rows.values()]};
    };
    return query;
  } };
}

test('reproduce partidas legítimas, incluida oleada 3 en menos de 45 s en móvil', async (t) => {
  let now=Date.UTC(2026,9,12);
  const db=database();
  const server=createApp(db,{gameSessionSecret:SECRET,now:()=>now,logger:()=>{}}).listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base='http://127.0.0.1:'+server.address().port;
  for (const [width,height] of [[1200,800],[600,800],[600,500],[600,400]]) {
    const {token}=await (await fetch(base+'/api/start-session')).json();
    const result=play(token,width,height);
    assert.equal(result.wave,3);
    if(height===400) assert.ok(result.replay.steps/120 < 45);
    now+=Math.ceil(result.replay.steps/120*1000);
    const body={name:'Auditoría',...result,runToken:token};
    const send=()=>fetch(base+'/api/scores',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const first=await send();
    assert.equal(first.status,201,await first.text());
    const retry=await send();
    assert.equal(retry.status,200);
    assert.equal((await retry.json()).score,result.score);
  }
  assert.equal(db.rows.size,4);
});

test('rechaza puntajes inventados después de esperar 120 s y registros alterados', async (t) => {
  let now=Date.UTC(2026,9,12);
  const db=database();
  const server=createApp(db,{gameSessionSecret:SECRET,now:()=>now,logger:()=>{}}).listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base='http://127.0.0.1:'+server.address().port;
  const {token}=await(await fetch(base+'/api/start-session')).json();
  now+=120000;
  const result=play(token,600,400);
  const send=(extra)=>fetch(base+'/api/scores',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:'Prueba',...result,runToken:token,...extra})});
  assert.equal((await send({score:15000,wave:8})).status,422);
  assert.equal((await send({replay:{...result.replay,steps:result.replay.steps-1}})).status,422);
  assert.equal((await send({replay:null})).status,422);
  assert.equal(db.rows.size,0);
});

test('el replay incluye resize y el worker calcula el mismo resultado', async () => {
  const token=createGameTicket(SECRET);
  const result=play(token,1200,800,{resize:true});
  assert.ok(result.replay.events.some(event=>event[1]==='r'));
  assert.deepEqual(await verifyRun(token,result.replay),{score:result.score,wave:result.wave});
  assert.equal(validateReplay({...result.replay,steps:MAX_RUN_STEPS+1}),false);
  assert.equal(validateReplay({...result.replay,events:[[0,'i',100,1]]}),false);
  assert.equal(validateReplay({...result.replay,world:[600,1]}),false);
  assert.equal(validateReplay({...result.replay,version:'old-rules'}),false);
});

test('la pérdida de conexión no elimina el timeout sin AbortSignal.any/timeout', async (t) => {
  const originalFetch=globalThis.fetch;
  const any=Object.getOwnPropertyDescriptor(AbortSignal,'any');
  const timeout=Object.getOwnPropertyDescriptor(AbortSignal,'timeout');
  Object.defineProperty(AbortSignal,'any',{configurable:true,value:undefined});
  Object.defineProperty(AbortSignal,'timeout',{configurable:true,value:undefined});
  t.after(()=>{globalThis.fetch=originalFetch;Object.defineProperty(AbortSignal,'any',any);Object.defineProperty(AbortSignal,'timeout',timeout);});
  const caller=new AbortController();
  let signal;
  globalThis.fetch=async(_url,options)=>{signal=options.signal;return {ok:true,status:200,json:()=>new Promise(()=>{})};};
  await assert.rejects(request({signal:caller.signal,timeoutMs:5}),error=>error.cause?.name==='TimeoutError');
  assert.equal(signal.aborted,true);
  assert.equal(caller.signal.aborted,false);
});

test('AoE afecta como máximo 9 tropas/3 filas en cada forma y durante la transición', () => {
  const token=createGameTicket(SECRET);
  for(const shape of ['grid','triangle','crescent']) {
    const game=createSimulation(token);
    game.wave=7;game.spawnWave();
    const slots=Enemy.slotsForFormation(shape,game.layout);
    game.enemies.filter(enemy=>!enemy.isBoss).forEach(enemy=>{enemy.setSlot(slots[enemy.index],true);enemy.update(0,game.formation);});
    const troops=game.enemies.filter(enemy=>!enemy.isBoss);
    for(const anchor of troops) {
      troops.forEach(enemy=>{enemy.health=enemy.maxHealth;enemy.alive=true;});
      const missile=game.player.shootMissile(500,500); missile.damage=999;
      game.detonateMissile(missile,anchor,troops);
      const affected=troops.filter(enemy=>!enemy.alive);
      assert.ok(affected.length<=9,shape);
      assert.ok(new Set(affected.map(enemy=>enemy.cellRow)).size<=3,shape);
      assert.ok(affected.includes(anchor));
    }
    game.updateFormation(7.01);
    assert.ok(game.enemies.filter(enemy=>!enemy.isBoss).every(enemy=>Number.isInteger(enemy.cellRow)));
  }
});

test('readiness detecta errores de esquema y los logs omiten datos privados', async (t) => {
  const logs=[];
  const db={from(){const query={select:()=>query,limit:()=>query,abortSignal:async()=>({error:{code:'42703',message:'PRIVATE_SERVICE_KEY'}})};return query;}};
  const server=createApp(db,{gameSessionSecret:SECRET,logger:record=>logs.push(record)}).listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(base+'/api/health')).status,200);
  assert.equal((await fetch(base+'/api/ready')).status,503);
  assert.equal(logs[0].code,'42703');
  assert.ok(logs[0].requestId);
  assert.ok(!JSON.stringify(logs).includes('PRIVATE_SERVICE_KEY'));
});

test('la partida espera el ticket y descarta una sesión que llega después de reiniciar', async (t) => {
  const originalFetch=globalThis.fetch;
  const originalDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{hidden:false}});
  t.after(()=>{globalThis.fetch=originalFetch;if(originalDocument)Object.defineProperty(globalThis,'document',originalDocument);else delete globalThis.document;});
  const token=createGameTicket(SECRET);
  const game=createSimulation(token,600,400);
  let resolve;
  globalThis.fetch=()=>new Promise(done=>{resolve=done;});
  Game.prototype.beginGameSession.call(game,game.runGeneration);
  assert.equal(game.state,'starting');
  game.update(5);
  assert.equal(game.recorder.steps,0);
  resolve({status:200,ok:true,json:async()=>({token})});
  await new Promise(done=>setImmediate(done));
  assert.equal(game.state,'playing');
  assert.equal(game.sessionToken,token);
  Game.prototype.beginGameSession.call(game,game.runGeneration);
  game.reset('playing',null);
  resolve({status:200,ok:true,json:async()=>({token})});
  await new Promise(done=>setImmediate(done));
  assert.equal(game.sessionToken,null);
  assert.equal(game.state,'playing');
});

test('los workers limitan concurrencia y liberan su capacidad al terminar', async () => {
  const token=createGameTicket(SECRET);
  const result=play(token,600,400);
  const responses=await Promise.allSettled([verifyRun(token,result.replay),verifyRun(token,result.replay),verifyRun(token,result.replay)]);
  assert.equal(responses.filter(r=>r.status==='fulfilled').length,2);
  assert.equal(responses.find(r=>r.status==='rejected').reason.status,503);
  assert.deepEqual(await verifyRun(token,result.replay),{score:result.score,wave:result.wave});
});

test('reproduce endgame con mejoras, jalapeños, misiles, secuaces y drops aleatorios', async () => {
  const token=createGameTicket(SECRET,Date.now(),2);
  const game=createSimulation(token,600,1400);
  // Un controlador de prueba usa exclusivamente los mismos botones del jugador.
  for(let tick=0;tick<60000 && game.state!=='over';tick++) {
    if(game.state==='upgrade_menu')game.applyUpgrade('damage');
    game.input.fire=true;
    if(game.player.jalapenoCount>0 && game.player.powerTime===0)game.activatePowerUp('jalapeno');
    if(game.player.chocloMisilCount>0)game.activatePowerUp('missile');
    const aim=game.player.x+game.player.width*.75;
    const enemy=[...game.enemies,...game.minions].sort((a,b)=>Math.abs(a.x+a.width/2-aim)-Math.abs(b.x+b.width/2-aim))[0];
    let desired=enemy ? enemy.x+enemy.width/2+(enemy.isBoss?0:game.formation.direction*game.enemySpeed*.7*(game.player.y-enemy.y)/820) : aim;
    const drop=game.powerUps.find(item=>item.y>game.player.y-180);
    if(drop)desired=drop.x+drop.width/2;
    const dx=desired-aim;
    game.input.direction=Math.abs(dx)>5 ? Math.sign(dx) : 0;
    if(game.enemyProjectiles.some(laser=>laser.y>game.player.y-160 && Math.abs(laser.x-aim)<70)) game.input.direction=game.player.x<250 ? 1 : -1;
    game.update(1/120);
  }
  assert.equal(game.state,'over');
  assert.equal(game.wave,15);
  const replay=game.recorder.export();
  assert.ok(replay.events.some(event=>event[1]==='u'));
  assert.ok(replay.events.some(event=>event[1]==='p'&&event[2]===0));
  assert.ok(replay.events.some(event=>event[1]==='p'&&event[2]===1));
  assert.deepEqual(await verifyRun(token,replay),{score:game.score,wave:game.wave});
});
