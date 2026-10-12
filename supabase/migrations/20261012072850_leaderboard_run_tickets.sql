-- Ejecutar después de 20261012065512_create_leaderboard.sql.
-- Un ticket firmado solo se acepta una vez: los registros históricos quedan NULL.
begin;

alter table public.leaderboard
  add column run_id uuid;

create unique index leaderboard_run_id_unique_idx
  on public.leaderboard (run_id)
  where run_id is not null;

comment on column public.leaderboard.run_id is
  'ID del ticket de partida firmado por el servidor; único para bloquear reenvíos.';

commit;
