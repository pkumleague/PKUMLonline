alter table live_states add column revision integer not null default 0;

update live_states set revision = 1 where revision = 0;

create table if not exists live_source_acks (
  game_id text not null references games(id) on delete cascade,
  source_id text not null,
  revision integer not null default 0,
  last_seen_at text not null default (datetime('now')),
  primary key (game_id, source_id)
);
