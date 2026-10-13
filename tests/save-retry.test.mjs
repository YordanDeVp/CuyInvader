import test from 'node:test';
import assert from 'node:assert/strict';
import { Leaderboard } from '../src/Leaderboard.js';
import { request } from '../src/api.js';

function fixture(t) {
  class Element {
    constructor(){this.children=[];this.value='';this.textContent='';this.disabled=false;}
    addEventListener(){} reset(){} reportValidity(){return true;} focus(){}
    append(child){this.children.push(child);} replaceChildren(...children){this.children=children[0]?.children??children;}
  }
  const documentDescriptor=Object.getOwnPropertyDescriptor(globalThis,'document');
  const storageDescriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const fetch=globalThis.fetch;
  const elements=new Map(),storage=new Map();
  Object.defineProperty(globalThis,'document',{configurable:true,value:{
    getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},
    createElement:()=>new Element(),createDocumentFragment:()=>new Element(),
  }});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)}});
  t.after(()=>{globalThis.fetch=fetch;if(documentDescriptor)Object.defineProperty(globalThis,'document',documentDescriptor);else delete globalThis.document;
    if(storageDescriptor)Object.defineProperty(globalThis,'localStorage',storageDescriptor);else delete globalThis.localStorage;});
  const board=new Leaderboard();
  board.setRunToken('test-ticket');board.setReplay({test:'immutable-proof'});board.sync('over',2410,3);board.nameInput.value='Yordan';
  return {board,storage};
}

test('una respuesta perdida permite confirmar el mismo POST y abre el Top 10 una sola vez', async (t) => {
  const {board,storage}=fixture(t);
  const payloads=[];
  let row;
  globalThis.fetch=async(_url,options={})=>{
    if(options.method==='POST'){
      const body=JSON.parse(options.body);payloads.push(body);
      row={id:'same-run',name:body.name,score:body.score,wave:body.wave};
      if(payloads.length===1)throw new TypeError('Respuesta perdida tras la escritura.');
      return {ok:true,status:200,json:async()=>row};
    }
    return {ok:true,status:200,json:async()=>[row]};
  };
  await board.submit();
  assert.equal(board.sent,false);
  assert.equal(board.entryCard.hidden,false);
  assert.equal(board.rankingCard.hidden,true);
  assert.equal(board.nameInput.disabled,false);
  assert.equal(board.button.disabled,false);
  assert.match(board.message.textContent,/sigue pendiente/);
  board.nameInput.value='Otro nombre';
  await board.submit();
  assert.deepEqual(payloads[1],payloads[0]);
  assert.equal(board.nameInput.value,'Yordan');
  assert.equal(board.sent,true);
  assert.equal(board.entryCard.hidden,true);
  assert.equal(board.rankingCard.hidden,false);
  assert.equal(board.title.textContent,'TOP 10 GLOBAL');
  assert.equal(board.body.children.length,1);
  assert.equal(JSON.parse(storage.get('cuy-invaders-local-leaderboard-v1')).filter(e=>e.name==='Yordan'&&e.score===2410).length,1);
});

test('un rechazo de nombre permite editarlo y enviar un payload corregido', async (t) => {
  const {board}=fixture(t);
  board.nameInput.value='<script>';
  const names=[];
  globalThis.fetch=async(_url,options={})=>{
    if(options.method==='POST'){
      const body=JSON.parse(options.body);names.push(body.name);
      return names.length===1 ? {status:400,json:async()=>({error:'Revisa el nombre.'})}
        : {status:201,json:async()=>body};
    }
    return {ok:true,status:200,json:async()=>[]};
  };
  await board.submit();
  assert.equal(board.pendingPayload,null);
  assert.equal(board.nameInput.disabled,false);
  board.nameInput.value='Nombre válido';
  await board.submit();
  assert.deepEqual(names,['<script>','Nombre válido']);
  assert.equal(board.sent,true);
});

test('reset aborta un POST y una confirmación tardía no abre el ranking en otra partida', async (t) => {
  const {board}=fixture(t);
  let resolve,signal;
  globalThis.fetch=(_url,options)=>{signal=options.signal;return new Promise(done=>{resolve=done;});};
  const pending=board.submit();
  board.reset();
  assert.equal(signal.aborted,true);
  resolve({status:201,json:async()=>({name:'Yordan',score:2410,wave:3})});
  await pending;
  assert.equal(board.rankingCard.hidden,true);
  assert.equal(board.message.textContent,'');
  assert.equal(board.button.disabled,false);
});

test('la API conserva Retry-After para reintentar después del límite de tráfico', async (t) => {
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async()=>({status:429,headers:{get:key=>key==='retry-after'?'2':'application/json'},json:async()=>({error:'Espera.'})});
  await assert.rejects(request(),error=>error.status===429&&error.retryAfterMs===2000);
});
