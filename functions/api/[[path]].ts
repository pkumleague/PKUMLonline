// Cloudflare Pages Functions catch-all for /api/*
// Route B: all database access is server-side via D1.
// The frontend talks to these endpoints through src/lib/supabase.ts,
// which keeps the existing page code's Supabase-like API surface.
//
// @ts-nocheck - intentionally untyped: wrangler/esbuild strips types and D1
// type declarations are not needed in the Astro tsconfig.

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS })
}

function error(message, status = 400) {
  return json({ error: { message } }, status)
}

async function readBody(request) {
  try {
    const text = await request.text()
    return text ? JSON.parse(text) : {}
  } catch {
    return {}
  }
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function toJson(value) {
  return value == null ? null : JSON.stringify(value)
}

function gameFromRow(row) {
  if (!row) return row
  return { ...row, seats: parseJson(row.seats, []) }
}

function roundFromRow(row) {
  if (!row) return row
  return {
    ...row,
    riichi: parseJson(row.riichi, [false, false, false, false]),
    tsumo_points: parseJson(row.tsumo_points, null),
    tenpai: parseJson(row.tenpai, null),
    override: parseJson(row.override, null),
  }
}

function unarrangedFromRow(row) {
  if (!row) return row
  return { ...row, seats: parseJson(row.seats, []) }
}

function newId() {
  return crypto.randomUUID()
}

function randomToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function toHex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return toHex(digest)
}

async function hashPassword(password) {
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  const iterations = 100000
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256,
  )
  return `pbkdf2$${iterations}$${toHex(salt)}$${toHex(bits)}`
}

async function verifyPassword(password, stored) {
  if (!stored) return false
  const [scheme, iterStr, saltHex, hashHex] = String(stored).split('$')
  if (scheme !== 'pbkdf2') return false
  const iterations = Number(iterStr) || 100000
  const salt = Uint8Array.from(saltHex.match(/.{2}/g) || [], (h) => parseInt(h, 16))
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256,
  )
  const actual = toHex(bits)
  if (actual.length !== hashHex.length) return false
  let diff = 0
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ hashHex.charCodeAt(i)
  return diff === 0
}

function bearerToken(request) {
  const header = request.headers.get('Authorization') || ''
  return header.startsWith('Bearer ') ? header.slice(7) : null
}

async function getAuth(env, request) {
  const token = bearerToken(request)
  if (!token) return null
  const tokenHash = await sha256Hex(token)
  const row = await env.DB.prepare(
    `select p.*, s.expires_at
     from sessions s
     join profiles p on p.id = s.user_id
     where s.token_hash = ?1 and s.expires_at > datetime('now')
     limit 1`,
  )
    .bind(tokenHash)
    .first()
  if (!row) return null
  return {
    token,
    tokenHash,
    user: { id: row.id, email: row.email },
    profile: {
      id: row.id,
      email: row.email,
      role: row.role,
      team: row.team ?? null,
      display_name: row.display_name ?? null,
    },
  }
}

function sessionPayload(auth) {
  if (!auth) return { session: null }
  return {
    session: {
      access_token: auth.token,
      user: auth.user,
      profile: auth.profile,
    },
  }
}

async function requireRole(env, request, roles, message = 'forbidden') {
  const auth = await getAuth(env, request)
  if (!auth) return { auth: null, response: error('未登录或会话已过期', 401) }
  if (!roles.includes(auth.profile.role)) return { auth, response: error(message, 403) }
  return { auth, response: null }
}

async function getGameRow(env, id) {
  return env.DB.prepare('select * from games where id = ?1').bind(id).first()
}

async function getRoundRow(env, id) {
  return env.DB.prepare('select * from rounds where id = ?1').bind(id).first()
}

async function allRows(stmt) {
  const res = await stmt.all()
  return res.results ?? []
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function handleAuthLogin(env, request) {
  const body = await readBody(request)
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  if (!email || !password) return error('请输入邮箱和密码', 400)

  const profile = await env.DB.prepare('select * from profiles where email = ?1').bind(email).first()
  if (!profile) return error('邮箱或密码错误', 401)
  const ok = await verifyPassword(password, profile.password_hash)
  if (!ok) return error('邮箱或密码错误', 401)

  const token = randomToken()
  const tokenHash = await sha256Hex(token)
  await env.DB.prepare(
    "insert into sessions (token_hash, user_id, expires_at) values (?1, ?2, datetime('now', '+30 days'))",
  )
    .bind(tokenHash, profile.id)
    .run()

  return json({
    session: {
      access_token: token,
      user: { id: profile.id, email: profile.email },
      profile: {
        id: profile.id,
        email: profile.email,
        role: profile.role,
        team: profile.team ?? null,
        display_name: profile.display_name ?? null,
      },
    },
  })
}

async function handleAuthLogout(env, request) {
  const token = bearerToken(request)
  if (token) {
    const tokenHash = await sha256Hex(token)
    await env.DB.prepare('delete from sessions where token_hash = ?1').bind(tokenHash).run()
  }
  return json({ ok: true })
}

async function handleAuthMe(env, request) {
  const auth = await getAuth(env, request)
  return json(sessionPayload(auth))
}

// ---------------------------------------------------------------------------
// Public reads
// ---------------------------------------------------------------------------

async function listGames(env) {
  const rows = await allRows(env.DB.prepare('select * from games order by date asc'))
  return json({ data: rows.map(gameFromRow) })
}

async function getGame(env, id) {
  const row = await getGameRow(env, id)
  if (!row) return error('game not found', 404)
  return json({ data: gameFromRow(row) })
}

async function listAnnouncements(env) {
  const rows = await allRows(env.DB.prepare('select * from announcements order by date desc'))
  return json({ data: rows })
}

async function getAnnouncement(env, id) {
  const row = await env.DB.prepare('select * from announcements where id = ?1').bind(id).first()
  if (!row) return error('announcement not found', 404)
  return json({ data: row })
}

async function listUnarranged(env) {
  const rows = await allRows(env.DB.prepare('select * from unarranged_games order by seq asc'))
  return json({ data: rows.map(unarrangedFromRow) })
}

async function getUnarranged(env, id) {
  const row = await env.DB.prepare('select * from unarranged_games where id = ?1').bind(id).first()
  if (!row) return error('unarranged game not found', 404)
  return json({ data: unarrangedFromRow(row) })
}

async function listRounds(env, request, gameId) {
  const game = await getGameRow(env, gameId)
  if (!game) return error('game not found', 404)
  const auth = await getAuth(env, request)
  const role = auth?.profile.role ?? null
  if (game.status !== 'finished' && role !== 'admin' && role !== 'referee') {
    return error('forbidden', 403)
  }
  const rows = await allRows(
    env.DB.prepare('select * from rounds where game_id = ?1 order by "order" asc').bind(gameId),
  )
  return json({ data: rows.map(roundFromRow) })
}

async function getLiveState(env, gameId) {
  const game = await getGameRow(env, gameId)
  if (!game) return error('game not found', 404)
  const row = await env.DB.prepare('select state, updated_at from live_states where game_id = ?1')
    .bind(gameId)
    .first()
  if (!row) return json({ data: null })
  return json({ data: parseJson(row.state, null), updated_at: row.updated_at })
}

async function updateLiveState(env, request, gameId) {
  const game = await getGameRow(env, gameId)
  if (!game) return error('game not found', 404)
  const auth = await getAuth(env, request)
  const role = auth?.profile.role ?? null
  const canWrite = role === 'admin' || (role === 'referee' && game.status === 'upcoming')
  if (!canWrite) return error('forbidden', 403)

  const body = await readBody(request)
  const state = body.state ?? body
  if (!state || typeof state !== 'object') return error('state is required')
  if (String(state.gameId ?? gameId) !== gameId) return error('state gameId mismatch')
  await env.DB.prepare(
    `insert into live_states (game_id, state, updated_at)
     values (?1, ?2, datetime('now'))
     on conflict(game_id) do update set state = excluded.state, updated_at = excluded.updated_at`,
  )
    .bind(gameId, toJson(state))
    .run()
  return json({ ok: true })
}

// ---------------------------------------------------------------------------
// Admin writes: announcements / games / unarranged
// ---------------------------------------------------------------------------

async function createAnnouncement(env, request) {
  const { auth, response } = await requireRole(env, request, ['admin'], '仅管理员可管理公告')
  if (response) return response
  const body = await readBody(request)
  const date = String(body.date || '')
  const title = String(body.title || '')
  const category = String(body.category || '公告')
  const text = String(body.body || '')
  if (!date || !title) return error('date and title are required')
  const id = newId()
  await env.DB.prepare(
    'insert into announcements (id, date, title, category, body) values (?1, ?2, ?3, ?4, ?5)',
  )
    .bind(id, date, title, category, text)
    .run()
  return json({ data: { id, date, title, category, body: text } })
}

async function updateAnnouncement(env, request, id) {
  const { response } = await requireRole(env, request, ['admin'], '仅管理员可管理公告')
  if (response) return response
  const body = await readBody(request)
  const existing = await env.DB.prepare('select * from announcements where id = ?1').bind(id).first()
  if (!existing) return error('announcement not found', 404)
  const date = body.date !== undefined ? String(body.date) : existing.date
  const title = body.title !== undefined ? String(body.title) : existing.title
  const category = body.category !== undefined ? String(body.category) : existing.category
  const text = body.body !== undefined ? String(body.body) : existing.body
  await env.DB.prepare(
    'update announcements set date = ?1, title = ?2, category = ?3, body = ?4 where id = ?5',
  )
    .bind(date, title, category, text, id)
    .run()
  return json({ data: { id, date, title, category, body: text } })
}

async function deleteAnnouncement(env, request, id) {
  const { response } = await requireRole(env, request, ['admin'], '仅管理员可管理公告')
  if (response) return response
  await env.DB.prepare('delete from announcements where id = ?1').bind(id).run()
  return json({ ok: true })
}

async function createGame(env, request) {
  const { response } = await requireRole(env, request, ['admin'], '仅管理员可管理赛程')
  if (response) return response
  const body = await readBody(request)
  const season = String(body.season || '')
  const stage = String(body.stage || '')
  const date = String(body.date || '')
  const time = body.time != null && body.time !== '' ? String(body.time) : null
  const round = body.round != null && body.round !== '' ? String(body.round) : null
  const liveStatus = body.live_status != null && body.live_status !== '' ? String(body.live_status) : null
  const seats = Array.isArray(body.seats) ? body.seats : []
  if (!season || !stage || !date || seats.length !== 4) return error('invalid game payload')
  const id = newId()
  await env.DB.prepare(
    `insert into games (id, season, stage, date, time, round, status, live_status, seats)
     values (?1, ?2, ?3, ?4, ?5, ?6, 'upcoming', ?7, ?8)`,
  )
    .bind(id, season, stage, date, time, round, liveStatus, toJson(seats))
    .run()
  return json({ data: { id } })
}

async function updateGame(env, request, id) {
  const { response } = await requireRole(env, request, ['admin'], '仅管理员可管理赛程')
  if (response) return response
  const body = await readBody(request)
  const existing = await getGameRow(env, id)
  if (!existing) return error('game not found', 404)
  const season = body.season !== undefined ? String(body.season) : existing.season
  const stage = body.stage !== undefined ? String(body.stage) : existing.stage
  const date = body.date !== undefined ? String(body.date) : existing.date
  const time = body.time !== undefined ? (body.time == null || body.time === '' ? null : String(body.time)) : existing.time
  const round = body.round !== undefined ? (body.round == null || body.round === '' ? null : String(body.round)) : existing.round
  const liveStatus = body.live_status !== undefined ? (body.live_status == null || body.live_status === '' ? null : String(body.live_status)) : existing.live_status
  const seats = body.seats !== undefined ? (Array.isArray(body.seats) ? toJson(body.seats) : existing.seats) : existing.seats
  await env.DB.prepare(
    `update games set season = ?1, stage = ?2, date = ?3, time = ?4, round = ?5,
     live_status = ?6, seats = ?7 where id = ?8`,
  )
    .bind(season, stage, date, time, round, liveStatus, seats, id)
    .run()
  return json({ ok: true })
}

async function deleteGame(env, request, id) {
  const { response } = await requireRole(env, request, ['admin'], '仅管理员可管理赛程')
  if (response) return response
  // Explicitly delete child rounds first (do not rely on SQLite FK cascade).
  await env.DB.batch([
    env.DB.prepare('delete from rounds where game_id = ?1').bind(id),
    env.DB.prepare('delete from games where id = ?1').bind(id),
  ])
  return json({ ok: true })
}

async function createUnarranged(env, request) {
  const { response } = await requireRole(env, request, ['admin'], '仅管理员可管理未安排赛程')
  if (response) return response
  const body = await readBody(request)
  const season = String(body.season || '')
  const stage = String(body.stage || '常规赛')
  const seq = Number(body.seq)
  const seats = Array.isArray(body.seats) ? body.seats : []
  if (!season || !stage || !Number.isInteger(seq) || seq < 1 || seats.length !== 4) return error('invalid unarranged payload')
  const duplicate = await env.DB.prepare(
    'select id from unarranged_games where season = ?1 and stage = ?2 and seq = ?3',
  )
    .bind(season, stage, seq)
    .first()
  if (duplicate) return error('该赛季该阶段序号已存在', 400)
  const id = newId()
  await env.DB.prepare(
    'insert into unarranged_games (id, season, stage, seq, seats) values (?1, ?2, ?3, ?4, ?5)',
  )
    .bind(id, season, stage, seq, toJson(seats))
    .run()
  return json({ data: { id } })
}

async function updateUnarranged(env, request, id) {
  const { response } = await requireRole(env, request, ['admin'], '仅管理员可管理未安排赛程')
  if (response) return response
  const body = await readBody(request)
  const existing = await env.DB.prepare('select * from unarranged_games where id = ?1').bind(id).first()
  if (!existing) return error('unarranged game not found', 404)
  const season = body.season !== undefined ? String(body.season) : existing.season
  const stage = body.stage !== undefined ? String(body.stage) : existing.stage
  const seq = body.seq !== undefined ? Number(body.seq) : existing.seq
  if (!Number.isInteger(seq) || seq < 1) return error('序号须为正整数')
  const seats = body.seats !== undefined ? toJson(body.seats) : existing.seats
  const duplicate = await env.DB.prepare(
    'select id from unarranged_games where season = ?1 and stage = ?2 and seq = ?3 and id <> ?4',
  )
    .bind(season, stage, seq, id)
    .first()
  if (duplicate) return error('该赛季该阶段序号已存在', 400)
  await env.DB.prepare(
    'update unarranged_games set season = ?1, stage = ?2, seq = ?3, seats = ?4 where id = ?5',
  )
    .bind(season, stage, seq, seats, id)
    .run()
  return json({ ok: true })
}

async function deleteUnarranged(env, request, id) {
  const { response } = await requireRole(env, request, ['admin'], '仅管理员可管理未安排赛程')
  if (response) return response
  await env.DB.prepare('delete from unarranged_games where id = ?1').bind(id).run()
  return json({ ok: true })
}

async function arrangeUnarranged(env, request, id) {
  const { response } = await requireRole(env, request, ['admin'], '仅管理员可安排赛程')
  if (response) return response
  const body = await readBody(request)
  const template = await env.DB.prepare('select * from unarranged_games where id = ?1').bind(id).first()
  if (!template) return error('unarranged game not found', 404)
  const date = String(body.date || '')
  if (!date) return error('date is required')
  const gameId = newId()
  await env.DB.batch([
    env.DB.prepare(
      `insert into games (id, season, stage, date, time, round, status, live_status, seats)
       values (?1, ?2, ?3, ?4, ?5, ?6, 'upcoming', ?7, ?8)`,
    )
      .bind(
        gameId,
        template.season,
        template.stage,
        date,
        body.time && body.time !== '' ? String(body.time) : null,
        body.round && body.round !== '' ? String(body.round) : null,
        body.live_status && body.live_status !== '' ? String(body.live_status) : null,
        template.seats,
      ),
    env.DB.prepare('delete from unarranged_games where id = ?1').bind(id),
  ])
  return json({ data: { id: gameId } })
}

// ---------------------------------------------------------------------------
// Rounds + match/captain operations
// ---------------------------------------------------------------------------

async function upsertRound(env, request, gameId) {
  const game = await getGameRow(env, gameId)
  if (!game) return error('game not found', 404)
  const auth = await getAuth(env, request)
  const role = auth?.profile.role ?? null
  const canWrite =
    role === 'admin' || (role === 'referee' && game.status === 'upcoming')
  if (!canWrite) return error('forbidden', 403)

  const body = await readBody(request)
  const round = body.round || body
  const order = Number(round.order)
  if (!Number.isInteger(order) || order < 1) return error('order is required')

  const existing = await env.DB.prepare(
    'select id from rounds where game_id = ?1 and "order" = ?2',
  )
    .bind(gameId, order)
    .first()
  if (existing) {
    // Partial upsert: only update fields that are present in the payload.
    // This is important for the result page's "save overrides" call, which sends
    // only { game_id, order, override, riichi } and must not wipe win_type etc.
    const updates = []
    const values = []
    if (round.win_type !== undefined) { updates.push('win_type = ?'); values.push(round.win_type) }
    if (round.riichi !== undefined) { updates.push('riichi = ?'); values.push(toJson(round.riichi)) }
    if (round.ron_winner !== undefined) { updates.push('ron_winner = ?'); values.push(round.ron_winner) }
    if (round.ron_loser !== undefined) { updates.push('ron_loser = ?'); values.push(round.ron_loser) }
    if (round.ron_points !== undefined) { updates.push('ron_points = ?'); values.push(round.ron_points) }
    if (round.tsumo_winner !== undefined) { updates.push('tsumo_winner = ?'); values.push(round.tsumo_winner) }
    if (round.tsumo_points !== undefined) { updates.push('tsumo_points = ?'); values.push(toJson(round.tsumo_points)) }
    if (round.tenpai !== undefined) { updates.push('tenpai = ?'); values.push(toJson(round.tenpai)) }
    if (round.override !== undefined) { updates.push('override = ?'); values.push(toJson(round.override)) }
    if (updates.length === 0) return json({ ok: true })
    values.push(gameId, order)
    await env.DB.prepare(
      `update rounds set ${updates.join(', ')} where game_id = ? and "order" = ?`,
    )
      .bind(...values)
      .run()
  } else {
    const id = round.id || newId()
    const winType = round.win_type ?? null
    const riichi = toJson(round.riichi ?? [false, false, false, false])
    const tsumoPoints = toJson(round.tsumo_points ?? null)
    const tenpai = toJson(round.tenpai ?? null)
    const override = toJson(round.override ?? null)
    await env.DB.prepare(
      `insert into rounds (id, game_id, "order", win_type, riichi, ron_winner, ron_loser,
       ron_points, tsumo_winner, tsumo_points, tenpai, override)
       values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    )
      .bind(
        id,
        gameId,
        order,
        winType,
        riichi,
        round.ron_winner ?? null,
        round.ron_loser ?? null,
        round.ron_points ?? null,
        round.tsumo_winner ?? null,
        tsumoPoints,
        tenpai,
        override,
      )
      .run()
  }
  return json({ ok: true })
}

async function updateRoundById(env, request, roundId) {
  const existing = await getRoundRow(env, roundId)
  if (!existing) return error('round not found', 404)
  const game = await getGameRow(env, existing.game_id)
  if (!game) return error('game not found', 404)
  const auth = await getAuth(env, request)
  const role = auth?.profile.role ?? null
  const canWrite = role === 'admin' || (role === 'referee' && game.status === 'upcoming')
  if (!canWrite) return error('forbidden', 403)

  const body = await readBody(request)
  const order = body.order !== undefined ? Number(body.order) : existing.order
  const update = []
  const values = []
  if (body.order !== undefined) { update.push('"order" = ?'); values.push(order) }
  if (body.win_type !== undefined) { update.push('win_type = ?'); values.push(body.win_type) }
  if (body.riichi !== undefined) { update.push('riichi = ?'); values.push(toJson(body.riichi)) }
  if (body.ron_winner !== undefined) { update.push('ron_winner = ?'); values.push(body.ron_winner) }
  if (body.ron_loser !== undefined) { update.push('ron_loser = ?'); values.push(body.ron_loser) }
  if (body.ron_points !== undefined) { update.push('ron_points = ?'); values.push(body.ron_points) }
  if (body.tsumo_winner !== undefined) { update.push('tsumo_winner = ?'); values.push(body.tsumo_winner) }
  if (body.tsumo_points !== undefined) { update.push('tsumo_points = ?'); values.push(toJson(body.tsumo_points)) }
  if (body.tenpai !== undefined) { update.push('tenpai = ?'); values.push(toJson(body.tenpai)) }
  if (body.override !== undefined) { update.push('override = ?'); values.push(toJson(body.override)) }
  if (update.length === 0) return json({ ok: true })
  values.push(roundId)
  await env.DB.prepare(`update rounds set ${update.join(', ')} where id = ?`).bind(...values).run()
  return json({ ok: true })
}

async function deleteRounds(env, request, gameId) {
  const game = await getGameRow(env, gameId)
  if (!game) return error('game not found', 404)
  const auth = await getAuth(env, request)
  const role = auth?.profile.role ?? null
  const canWrite = role === 'admin' || (role === 'referee' && game.status === 'upcoming')
  if (!canWrite) return error('forbidden', 403)

  const url = new URL(request.url)
  const after = url.searchParams.get('after')
  const winTypeNull = url.searchParams.get('winType') === 'null'
  if (after !== null) {
    const order = Number(after)
    if (!Number.isInteger(order)) return error('invalid after')
    await env.DB.prepare('delete from rounds where game_id = ?1 and "order" > ?2')
      .bind(gameId, order)
      .run()
    return json({ ok: true })
  }
  if (winTypeNull) {
    await env.DB.prepare('delete from rounds where game_id = ?1 and win_type is null')
      .bind(gameId)
      .run()
    return json({ ok: true })
  }
  return error('missing delete filter')
}

async function fillPlayers(env, request, gameId) {
  const { response } = await requireRole(env, request, ['admin', 'referee'], '仅管理员/裁判可批量填选手')
  if (response) return response
  const game = await getGameRow(env, gameId)
  if (!game) return error('game not found', 404)
  if (game.status !== 'upcoming') return error('game already finished')
  const body = await readBody(request)
  const inputSeats = Array.isArray(body.seats) ? body.seats : []
  if (inputSeats.length !== 4) return error('seats must be 4')
  const oldSeats = parseJson(game.seats, [])
  if (oldSeats.length !== 4) return error('game seats must be 4')
  const newSeats = oldSeats.map((old, i) => {
    const input = inputSeats[i] || {}
    if (old.seat !== input.seat || old.team !== input.team) {
      throw new Error(`seat ${i} does not match original game seats`)
    }
    return { ...old, player: input.player ?? null }
  })
  await env.DB.prepare('update games set seats = ?1 where id = ?2')
    .bind(toJson(newSeats), gameId)
    .run()
  return json({ data: newSeats })
}

async function assignPlayer(env, request, gameId) {
  const { auth, response } = await requireRole(env, request, ['captain', 'admin'], 'forbidden')
  if (response) return response
  const game = await getGameRow(env, gameId)
  if (!game) return error('game not found', 404)
  if (game.status !== 'upcoming') return error('game already finished')
  const body = await readBody(request)
  const player = String(body.player || '')
  if (!player) return error('player required')
  const seats = parseJson(game.seats, [])
  if (seats.length !== 4) return error('game seats must be 4')
  const role = auth.profile.role
  let idx = -1
  if (role === 'captain') {
    idx = seats.findIndex((s) => s.team === auth.profile.team)
  } else {
    idx = 0 // matches the old admin branch of assign_player RPC
  }
  if (idx < 0) return error('no assignable seat')
  const newSeats = seats.map((s, i) => (i === idx ? { ...s, player } : s))
  await env.DB.prepare('update games set seats = ?1 where id = ?2')
    .bind(toJson(newSeats), gameId)
    .run()
  return json({ data: newSeats })
}

async function finishGame(env, request, gameId) {
  const { response } = await requireRole(env, request, ['referee', 'admin'], 'forbidden')
  if (response) return response
  const game = await getGameRow(env, gameId)
  if (!game) return error('game not found', 404)
  if (game.status !== 'upcoming') return error('game already finished')
  const body = await readBody(request)
  const inputSeats = Array.isArray(body.seats) ? body.seats : []
  if (inputSeats.length !== 4) return error('seats must be 4')
  const oldSeats = parseJson(game.seats, [])
  if (oldSeats.length !== 4) return error('game seats must be 4')

  let sum = 0
  const ranks = []
  const newSeats = oldSeats.map((old, i) => {
    const input = inputSeats[i] || {}
    if (
      old.seat !== input.seat ||
      old.team !== input.team ||
      old.player !== input.player ||
      old.player == null ||
      input.player == null ||
      input.rank == null ||
      input.points == null
    ) {
      throw new Error(`seat ${i} does not match original game seats or is incomplete`)
    }
    const points = Number(input.points)
    const rank = Number(input.rank)
    if (!Number.isFinite(points) || !Number.isInteger(rank)) throw new Error(`seat ${i} invalid data`)
    sum += points
    ranks.push(rank)
    return {
      seat: old.seat,
      team: old.team,
      player: old.player,
      rank,
      points,
      pt: input.pt !== undefined ? Number(input.pt) : old.pt,
      penalty: input.penalty !== undefined ? Number(input.penalty) : old.penalty ?? 0,
    }
  })
  if (sum !== 100000) return error(`points total must be 100000, got ${sum}`)
  if (ranks.some((r) => r < 1 || r > 4)) return error('rank out of range')

  await env.DB.prepare("update games set seats = ?1, status = 'finished' where id = ?2")
    .bind(toJson(newSeats), gameId)
    .run()
  return json({ data: newSeats })
}

async function unfinishGame(env, request, gameId) {
  const { response } = await requireRole(env, request, ['admin'], '仅管理员可退回赛果')
  if (response) return response
  const game = await getGameRow(env, gameId)
  if (!game) return error('game not found', 404)
  await env.DB.prepare("update games set status = 'upcoming' where id = ?1").bind(gameId).run()
  return json({ ok: true })
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function onRequest(context) {
  const { request, env } = context
  const url = new URL(request.url)
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean)
  const method = request.method.toUpperCase()

  try {
    // auth
    if (parts[0] === 'auth' && method === 'POST' && parts[1] === 'login') return handleAuthLogin(env, request)
    if (parts[0] === 'auth' && method === 'POST' && parts[1] === 'logout') return handleAuthLogout(env, request)
    if (parts[0] === 'auth' && method === 'GET' && parts[1] === 'me') return handleAuthMe(env, request)

    // announcements
    if (parts[0] === 'announcements' && parts.length === 1 && method === 'GET') return listAnnouncements(env)
    if (parts[0] === 'announcements' && parts.length === 1 && method === 'POST') return createAnnouncement(env, request)
    if (parts[0] === 'announcements' && parts.length === 2 && method === 'GET') return getAnnouncement(env, parts[1])
    if (parts[0] === 'announcements' && parts.length === 2 && method === 'PUT') return updateAnnouncement(env, request, parts[1])
    if (parts[0] === 'announcements' && parts.length === 2 && method === 'DELETE') return deleteAnnouncement(env, request, parts[1])

    // unarranged
    if (parts[0] === 'unarranged' && parts.length === 1 && method === 'GET') return listUnarranged(env)
    if (parts[0] === 'unarranged' && parts.length === 1 && method === 'POST') return createUnarranged(env, request)
    if (parts[0] === 'unarranged' && parts.length === 2 && method === 'GET') return getUnarranged(env, parts[1])
    if (parts[0] === 'unarranged' && parts.length === 2 && method === 'PUT') return updateUnarranged(env, request, parts[1])
    if (parts[0] === 'unarranged' && parts.length === 2 && method === 'DELETE') return deleteUnarranged(env, request, parts[1])
    if (parts[0] === 'unarranged' && parts[1] === 'arrange') {
      // not used directly by frontend (shim routes to /unarranged/:id/arrange)
      return error('not found', 404)
    }
    if (parts[0] === 'unarranged' && parts.length === 3 && parts[2] === 'arrange' && method === 'POST') {
      return arrangeUnarranged(env, request, parts[1])
    }

    // games
    if (parts[0] === 'games' && parts.length === 1 && method === 'GET') return listGames(env)
    if (parts[0] === 'games' && parts.length === 1 && method === 'POST') return createGame(env, request)
    if (parts[0] === 'games' && parts.length === 2 && method === 'GET') return getGame(env, parts[1])
    if (parts[0] === 'games' && parts.length === 2 && method === 'PUT') return updateGame(env, request, parts[1])
    if (parts[0] === 'games' && parts.length === 2 && method === 'DELETE') return deleteGame(env, request, parts[1])

    // game-scoped rounds and match actions
    if (parts[0] === 'games' && parts.length === 3) {
      const gameId = decodeURIComponent(parts[1])
      if (parts[2] === 'live-state') {
        if (method === 'GET') return getLiveState(env, gameId)
        if (method === 'PUT') return updateLiveState(env, request, gameId)
      }
      if (parts[2] === 'rounds') {
        if (method === 'GET') return listRounds(env, request, gameId)
        if (method === 'PUT') return upsertRound(env, request, gameId)
        if (method === 'DELETE') return deleteRounds(env, request, gameId)
      }
      if (parts[2] === 'fill-players' && method === 'POST') return fillPlayers(env, request, gameId)
      if (parts[2] === 'assign' && method === 'POST') return assignPlayer(env, request, gameId)
      if (parts[2] === 'finish' && method === 'POST') return finishGame(env, request, gameId)
      if (parts[2] === 'unfinish' && method === 'POST') return unfinishGame(env, request, gameId)
    }

    // round by id
    if (parts[0] === 'rounds' && parts.length === 2 && method === 'PUT') {
      return updateRoundById(env, request, decodeURIComponent(parts[1]))
    }

    return error('not found', 404)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return error(message, 400)
  }
}
