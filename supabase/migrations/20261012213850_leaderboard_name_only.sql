-- Ejecutar después de las migraciones de la tabla y run_id.
-- Une los datos actuales para conservar los apellidos ya publicados.
begin;

alter table public.leaderboard
  drop constraint if exists leaderboard_first_name_check;

update public.leaderboard
set first_name = left(
  btrim(concat_ws(' ', nullif(btrim(first_name), ''), nullif(btrim(last_name), ''))),
  60
);

alter table public.leaderboard
  rename column first_name to name;

alter table public.leaderboard
  drop column last_name;

alter table public.leaderboard
  add constraint leaderboard_name_check
  check (char_length(btrim(name)) between 1 and 60);

comment on column public.leaderboard.name is
  'Nombre mostrado en el ranking; puede incluir el apellido.';

commit;
