create table if not exists live_states (
  game_id text primary key references games(id) on delete cascade,
  state text not null,
  updated_at text not null default (datetime('now'))
);
