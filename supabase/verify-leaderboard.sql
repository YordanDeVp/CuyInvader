-- Comprobaciones de solo lectura después de ejecutar ambas migraciones.
-- Esperado: rls_enabled=true, public_policies=0.
select c.relrowsecurity as rls_enabled,
  (select count(*) from pg_policies
   where schemaname = 'public' and tablename = 'leaderboard') as public_policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'leaderboard';

-- Esperado: anon/authenticated false en ambas; service_role true en ambas.
select role_name,
  has_table_privilege(role_name, 'public.leaderboard', 'SELECT') as can_select,
  has_table_privilege(role_name, 'public.leaderboard', 'INSERT') as can_insert
from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name);

-- Después de la migración de tickets: run_id existe y tiene índice único parcial.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'leaderboard' and column_name = 'run_id';

select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename = 'leaderboard'
  and indexname = 'leaderboard_run_id_unique_idx';
