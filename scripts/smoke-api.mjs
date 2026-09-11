#!/usr/bin/env node
// Optional local smoke test for Pages Functions API.
//
// Uses Node's built-in SQLite (node:sqlite, available in Node >=22.5) as a
// stand-in for D1 so routes, SQL, authentication and role checks can be
// exercised without Wrangler/Cloudflare. It is intentionally not part of
// `npm test`; run it with:
//
//   npm run smoke:api
//
// The real D1/Wrangler flow is still verified separately with:
//   npm run db:migrate:local
//   npm run pages:dev

import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'

const { onRequest } = await import('../functions/api/[[path]].ts')

const db = new DatabaseSync(':memory:')
db.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'))
db.exec(readFileSync(new URL('../migrations/0002_live_state.sql', import.meta.url), 'utf8'))
db.exec(readFileSync(new URL('../migrations/0003_schedule_draft.sql', import.meta.url), 'utf8'))
db.exec(readFileSync(new URL('../migrations/0004_live_reliability.sql', import.meta.url), 'utf8'))

class MockStatement {
  constructor(db, sql) {
    this.db = db
    this.sql = sql
    this.values = []
  }
  bind(...values) {
    this.values = values
    return this
  }
  first() {
    return this.db.prepare(this.sql).get(...this.values) ?? null
  }
  all() {
    return { results: this.db.prepare(this.sql).all(...this.values) }
  }
  run() {
    this.db.prepare(this.sql).run(...this.values)
    return { success: true }
  }
}

const env = {
  DB: {
    prepare(sql) {
      return new MockStatement(db, sql)
    },
    async batch(stmts) {
      db.exec('BEGIN')
      try {
        for (const s of stmts) await s.run()
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
  },
}

function toHex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hashPassword(password) {
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  const iterations = 100000
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, keyMaterial, 256)
  return `pbkdf2$${iterations}$${toHex(salt)}$${toHex(bits)}`
}

async function call(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const req = new Request(`http://localhost/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const res = await onRequest({ request: req, env })
  const data = await res.json()
  return { status: res.status, data }
}

function assert(cond, msg) {
  if (!cond) {
    console.error('ASSERT FAILED:', msg)
    process.exit(1)
  }
}

async function createUser(email, password, role, team = null) {
  const hash = await hashPassword(password)
  db.prepare(
    'insert into profiles (id, email, password_hash, role, team, display_name) values (?,?,?,?,?,?)',
  ).run(crypto.randomUUID(), email, hash, role, team, email)
  const r = await call('/auth/login', { method: 'POST', body: { email, password } })
  assert(r.status === 200 && r.data.session?.access_token, `login failed for ${email}`)
  return r.data.session.access_token
}

// ---- users ----
const adminToken = await createUser('admin@example.com', 'admin123', 'admin')
const refereeToken = await createUser('referee@example.com', 'referee123', 'referee')
const captainToken = await createUser('captain@example.com', 'captain123', 'captain', '樱花')

// ---- role restrictions ----
let r = await call('/games', { method: 'POST', token: refereeToken, body: { season: '26-27', stage: '常规赛', date: '2026-09-01' } })
assert(r.status === 403, `referee create game should be 403, got ${r.status}`)

r = await call('/announcements', { method: 'POST', token: captainToken, body: { date: '2026-09-01', title: 'x' } })
assert(r.status === 403, `captain create announcement should be 403, got ${r.status}`)

r = await call('/auth/me', { token: adminToken })
assert(r.data.session.profile.role === 'admin', 'admin me role')

// ---- unarranged arrange ----
r = await call('/unarranged', {
  method: 'POST',
  token: adminToken,
  body: {
    season: '26-27',
    stage: '常规赛',
    seq: 1,
    seats: [
      { seat: '东', team: '樱花', player: null },
      { seat: '南', team: '雷电', player: null },
      { seat: '西', team: '赤坂', player: null },
      { seat: '北', team: '凤凰', player: null },
    ],
  },
})
assert(r.status === 200 && r.data.data?.id, 'admin create unarranged failed')
const unarrangedId = r.data.data.id

r = await call(`/unarranged/${unarrangedId}/arrange`, {
  method: 'POST',
  token: refereeToken,
  body: { date: '2026-09-05' },
})
assert(r.status === 403, `referee arrange should be 403, got ${r.status}`)

r = await call(`/unarranged/${unarrangedId}/arrange`, {
  method: 'POST',
  token: adminToken,
  body: { date: '2026-09-05', time: '14:00', round: '第1半庄', live_status: '直播' },
})
assert(r.status === 200 && r.data.data?.id, 'admin arrange failed')
const arrangedGameId = r.data.data.id

// ---- game + fill players + captain assign ----
const baseSeats = [
  { seat: '东', team: '樱花', player: null },
  { seat: '南', team: '雷电', player: null },
  { seat: '西', team: '赤坂', player: null },
  { seat: '北', team: '凤凰', player: null },
]
r = await call('/games', { method: 'POST', token: adminToken, body: { season: '26-27', stage: '常规赛', date: '2026-09-10', seats: baseSeats } })
assert(r.status === 200 && r.data.data?.id, 'admin create game failed')
const gameId = r.data.data.id

r = await call(`/games/${gameId}/rounds`)
assert(r.status === 403, `public upcoming rounds should be 403, got ${r.status}`)

const filledSeats = baseSeats.map((s) => ({ ...s, player: `${s.team}选手` }))
r = await call(`/games/${gameId}/fill-players`, { method: 'POST', token: refereeToken, body: { seats: filledSeats } })
assert(r.status === 200, `referee fill players failed ${r.status} ${JSON.stringify(r.data)}`)

r = await call(`/games/${gameId}/assign`, { method: 'POST', token: captainToken, body: { player: '樱花队长选人' } })
assert(r.status === 200, `captain assign should succeed, got ${r.status} ${JSON.stringify(r.data)}`)

// captain assign should only touch the captain's own team seat (东/樱花)
r = await call(`/games/${gameId}`, { token: adminToken })
const afterCaptain = r.data.data
assert(afterCaptain.seats[0].player === '樱花队长选人', 'captain assignment should set player on own team seat')
assert(afterCaptain.seats[1].player === '雷电选手', 'captain assignment should not modify other seats')
const currentSeats = afterCaptain.seats

// ---- reliable live state revision / conflict / source acknowledgement ----
r = await call(`/games/${gameId}/live-state`)
assert(r.status === 200 && r.data.revision === 0 && r.data.data === null, 'new live state should start at revision 0')

const liveState1 = { gameId, rounds: [], updatedAt: new Date().toISOString() }
r = await call(`/games/${gameId}/live-state`, {
  method: 'PUT',
  token: refereeToken,
  body: { state: liveState1, baseRevision: 0 },
})
assert(r.status === 200 && r.data.revision === 1, `first live publish should create revision 1, got ${r.status} ${JSON.stringify(r.data)}`)

r = await call(`/games/${gameId}/live-state`, {
  method: 'PUT',
  token: refereeToken,
  body: { state: { ...liveState1, updatedAt: new Date().toISOString() }, baseRevision: 0 },
})
assert(r.status === 409 && r.data.error?.currentRevision === 1, 'stale live publish should be rejected with current revision')

r = await call(`/games/${gameId}/live-state`, {
  method: 'PUT',
  token: refereeToken,
  body: { state: { ...liveState1, updatedAt: new Date().toISOString() }, baseRevision: 1 },
})
assert(r.status === 200 && r.data.revision === 2, 'matching live revision should advance atomically')

const retriedLiveState = { ...liveState1, publishId: crypto.randomUUID(), updatedAt: new Date().toISOString() }
r = await call(`/games/${gameId}/live-state`, {
  method: 'PUT',
  token: refereeToken,
  body: { state: retriedLiveState, baseRevision: 2 },
})
assert(r.status === 200 && r.data.revision === 3, 'idempotent live publish should advance once')
r = await call(`/games/${gameId}/live-state`, {
  method: 'PUT',
  token: refereeToken,
  body: { state: retriedLiveState, baseRevision: 2 },
})
assert(r.status === 200 && r.data.revision === 3 && r.data.duplicate === true, 'retry after a lost response should reuse the saved revision')

r = await call(`/games/${gameId}/live-ack`, { method: 'POST', body: { sourceId: 'main', revision: 3 } })
assert(r.status === 200, `live source acknowledgement should succeed, got ${r.status}`)

r = await call(`/games/${gameId}/live-ack?sourceId=main`, { token: refereeToken })
assert(r.status === 200 && r.data.data?.revision === 3, 'referee should read the live source acknowledgement')

// ---- rounds upsert / update / delete ----
r = await call(`/games/${gameId}/rounds`, {
  method: 'PUT',
  token: refereeToken,
  body: { round: { game_id: gameId, order: 1, win_type: 'draw', riichi: [false, false, false, false], tenpai: [false, false, false, false] } },
})
assert(r.status === 200, `referee round upsert should succeed, got ${r.status} ${JSON.stringify(r.data)}`)

r = await call(`/games/${gameId}/rounds`, { token: adminToken })
assert(r.status === 200 && r.data.data.length === 1, 'rounds list should contain one round')
const roundId = r.data.data[0].id

r = await call(`/rounds/${roundId}`, { method: 'PUT', token: refereeToken, body: { override: { roundLabel: '东1局 1本场' } } })
assert(r.status === 200, `referee round update should succeed, got ${r.status}`)

// Partial game/order upsert (result page save-overrides style) must not wipe win_type.
r = await call(`/games/${gameId}/rounds`, {
  method: 'PUT',
  token: refereeToken,
  body: { round: { game_id: gameId, order: 1, riichi: [false, false, false, false], override: { roundLabel: '东1局 2本场' } } },
})
assert(r.status === 200, `partial round upsert should succeed, got ${r.status}`)
r = await call(`/games/${gameId}/rounds`, { token: adminToken })
assert(r.status === 200 && r.data.data[0].win_type === 'draw', 'partial upsert must preserve win_type')

// referee cannot update rounds on a finished game
r = await call(`/games/${gameId}/finish`, {
  method: 'POST',
  token: adminToken,
  body: {
    seats: currentSeats.map((s, i) => ({
      ...s,
      rank: i + 1,
      points: [40000, 30000, 20000, 10000][i],
      pt: 0,
      penalty: 0,
    })),
  },
})
assert(r.status === 200, `admin finish failed ${r.status} ${JSON.stringify(r.data)}`)

r = await call(`/rounds/${roundId}`, { method: 'PUT', token: refereeToken, body: { override: null } })
assert(r.status === 403, `referee update finished round should be 403, got ${r.status}`)

r = await call(`/games/${gameId}/rounds`)
assert(r.status === 200 && Array.isArray(r.data.data), 'public finished rounds should be readable')

// ---- unfinish only admin ----
r = await call(`/games/${gameId}/unfinish`, { method: 'POST', token: refereeToken })
assert(r.status === 403, `referee unfinish should be 403, got ${r.status}`)

r = await call(`/games/${gameId}/unfinish`, { method: 'POST', token: adminToken })
assert(r.status === 200, `admin unfinish should succeed, got ${r.status}`)

// ---- bad finish total rejected ----
r = await call(`/games/${gameId}/finish`, {
  method: 'POST',
  token: adminToken,
  body: {
    seats: currentSeats.map((s, i) => ({
      ...s,
      rank: i + 1,
      points: [40000, 30000, 20000, 9999][i],
      pt: 0,
      penalty: 0,
    })),
  },
})
assert(r.status === 400, `finish with bad total should be 400, got ${r.status}`)

console.log('API smoke test passed')
