-- Ejecutar UNA VEZ en el editor SQL de Supabase. Si ya existe la tabla,
-- aborta la transacción en vez de conservar políticas antiguas por accidente.
begin;

create table public.leaderboard (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (char_length(btrim(first_name)) between 1 and 60),
  last_name text not null check (char_length(btrim(last_name)) between 1 and 60),
  -- BIGINT en Postgres, acotado al rango entero exacto del cliente JavaScript.
  score bigint not null check (score between 0 and 9007199254740991),
  wave integer not null check (wave between 1 and 10000),
  created_at timestamptz not null default now()
);

-- Score DESC primero; los desempates conservan un orden estable.
create index leaderboard_score_desc_idx
  on public.leaderboard (score desc, created_at asc, id asc);

alter table public.leaderboard enable row level security;
-- Sin políticas públicas. También retiramos los grants por defecto.
revoke all on public.leaderboard from public, anon, authenticated, service_role;
grant select, insert on public.leaderboard to service_role;
-- La clave del servidor usa service_role (BYPASSRLS), jamás el navegador.
commit;
