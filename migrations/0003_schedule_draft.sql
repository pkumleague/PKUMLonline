create table if not exists schedule_draft_state (
  id integer primary key check (id = 1),
  base_games text not null,
  draft_games text not null,
  base_unarranged text not null,
  draft_unarranged text not null,
  updated_at text not null default (datetime('now'))
);
