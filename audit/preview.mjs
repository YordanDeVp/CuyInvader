// Preview explícito para QA. Datos en memoria; nunca toca Supabase.
import { randomBytes } from 'node:crypto';
import { createApp } from '../server.js';
const rows = new Map();
const db = { from() {
  let entry, lookup;
  const query = {};
  for (const name of ['select','order','limit','single','maybeSingle']) query[name] = () => query;
  query.eq = (_name,id) => { lookup=id; return query; };
  query.insert = value => { entry=value; return query; };
  query.abortSignal = async () => {
    if (lookup) return { data: rows.get(lookup) ?? null };
    if (entry) {
      if (rows.has(entry.run_id)) return { error:{code:'23505'} };
      const saved={...entry,id:entry.run_id,created_at:new Date().toISOString()};
      rows.set(entry.run_id,saved);
      return {data:saved};
    }
    return {data:[...rows.values()].sort((a,b)=>b.score-a.score).slice(0,10)};
  };
  return query;
} };
const server = createApp(db,{gameSessionSecret:randomBytes(32).toString('base64url')}).listen(0,'127.0.0.1',()=>{
  console.log('QA local con base simulada: http://127.0.0.1:'+server.address().port);
});
