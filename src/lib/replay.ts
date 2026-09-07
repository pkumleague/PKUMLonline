import { dealerSeat, nextRound, settleRound } from './scoring'
import type { RoundResult, RoundState } from './scoring'
import { SEAT_ORDER, seatIndexOf } from './games'

/** DB rounds 行（tsumo_points 为 jsonb 拆分数组） */
export interface StoredRound {
  order: number
  reset?: RoundReset | null
  win_type: 'ron' | 'tsumo' | 'draw' | null
  riichi: boolean[]
  ron_winner: string | null
  ron_loser: string | null
  ron_points: number | null
  tsumo_winner: string | null
  tsumo_points: number[] | null
  tenpai: boolean[] | null
  /** 手动覆盖：自动生成的行可被录入人手动修改（四家增减/对局情况/打点） */
  override?: RoundOverride
}

export interface RoundReset {
  round: RoundState
  scores: number[]
  pool: number
  label?: string
}

export interface RoundOverride {
  /** 手动设定的四家本小局增减 */
  deltas?: number[]
  /** 手动设定的对局情况文案（如「荣和·东」） */
  result?: string
  /** 手动设定的打点 */
  points?: number
  /** 手动设定的供托（点数） */
  pool?: number
  /** 手动设定的局名文案（如「东3局 1本场」），优先于自动推导显示 */
  roundLabel?: string
}

export interface RoundHistory {
  order: number
  /** 该小局结算时的局状态（局名/本场） */
  round: RoundState
  result: RoundResult
  /** 结算后四家累计分数 */
  scores: number[]
  /** 结算后供托棒数 */
  pool: number
  /** 本小局各家的增减（手动覆盖时取 override.deltas） */
  deltas: number[]
  /** 手动覆盖（若有） */
  override?: RoundOverride
}

export interface ReplayState {
  /** 当前待录/下一局状态 */
  round: RoundState
  /** 四家累计分数（初始 25000） */
  scores: number[]
  /** 当前供托棒数 */
  pool: number
  /** 已结算小局数 */
  settled: number
  /** 未完成的草稿局（若有，可继续补全） */
  draft?: StoredRound
}

export interface ReplayResult {
  current: ReplayState
  history: RoundHistory[]
  /** 半庄终局仍有供托时的最终归属；三家并列第一须由录入人手动处理。 */
  finalPool?: FinalPoolSettlement
}

export interface FinalPoolSettlement {
  amount: number
  recipients: number[]
  distribution: number[]
  requiresManual: boolean
}

function buildRoundResult(r: StoredRound, state: RoundState): RoundResult {
  const riichi = r.riichi ?? [false, false, false, false]
  if (r.win_type === 'ron') {
    return {
      winType: 'ron',
      riichi,
      winner: seatIndexOf(r.ron_winner ?? ''),
      loser: seatIndexOf(r.ron_loser ?? ''),
      ronPoints: r.ron_points ?? 0,
    }
  }
  if (r.win_type === 'tsumo') {
    const w = seatIndexOf(r.tsumo_winner ?? '')
    const split = r.tsumo_points ?? []
    const pays = [0, 0, 0, 0]
    if (split.length === 1) {
      for (let i = 0; i < 4; i++) if (i !== w) pays[i] = split[0]
    } else {
      const d = dealerSeat(state)
      for (let i = 0; i < 4; i++) {
        if (i === w) continue
        pays[i] = i === d ? (split[1] ?? split[0]) : split[0]
      }
    }
    return { winType: 'tsumo', riichi, winner: w, tsumoPayments: pays }
  }
  return { winType: 'draw', riichi, tenpai: r.tenpai ?? [false, false, false, false] }
}

/**
 * 从头回放一场半庄：按 order 逐小局结算，累积四家分数与供托池。
 * 遇到未完成（win_type 为 null）的草稿局即停，返回当前局状态供继续录入。
 */
export function replayGame(rounds: StoredRound[], startScore = 25000): ReplayResult {
  const sorted = [...rounds].sort((a, b) => a.order - b.order)
  let state: RoundState = { wind: '东', number: 1, honba: 0 }
  let scores = [startScore, startScore, startScore, startScore]
  let pool = 0
  const history: RoundHistory[] = []
  let settled = 0
  let draft: StoredRound | undefined
  let ended = false

  for (const r of sorted) {
    if (r.reset) {
      state = { ...r.reset.round }
      scores = [0, 1, 2, 3].map((i) => Number(r.reset!.scores[i] ?? 25000))
      pool = Number(r.reset.pool) || 0
      settled = 0
      draft = undefined
      continue
    }
    if (!r.win_type) {
      draft = r
      break
    }
    const result = buildRoundResult(r, state)
    const auto = settleRound(state, result, pool)
    const deltas = r.override?.deltas ?? auto.deltas
    scores = scores.map((v, i) => v + deltas[i])
    pool = auto.poolAfter // 供托池仍按立直/和了类型跟踪（手动增减不影响池）
    history.push({
      order: r.order,
      round: { ...state },
      result,
      scores: [...scores],
      pool: r.override?.pool ?? auto.poolAfter, // 供托展示值：手动覆盖优先
      deltas,
      override: r.override,
    })
    settled++
    const next = nextRound(state, result)
    if (!next) {
      ended = true
      break // 半庄结束（南四推进）
    }
    state = next
  }

  let finalPool: FinalPoolSettlement | undefined
  if (ended && pool > 0) {
    const amount = pool * 1000
    const topScore = Math.max(...scores)
    const recipients = scores.map((score, i) => score === topScore ? i : -1).filter((i) => i >= 0)
    const requiresManual = recipients.length === 3
    const distribution = [0, 0, 0, 0]
    if (!requiresManual) {
      const share = amount / recipients.length
      recipients.forEach((i) => { distribution[i] = share })
      scores = scores.map((score, i) => score + distribution[i])
      pool = 0
      const latest = history[history.length - 1]
      if (latest) {
        latest.scores = [...scores]
        latest.pool = 0
        latest.deltas = latest.deltas.map((delta, i) => delta + distribution[i])
      }
    }
    finalPool = { amount, recipients, distribution, requiresManual }
  }

  return {
    current: { round: state, scores, pool, settled, draft },
    history,
    finalPool,
  }
}

/** 局名文案：如「东1局」/「南3局」，含本场数 */
export function roundLabel(round: RoundState): string {
  return `${round.wind}${round.number}局${round.honba > 0 ? ` ${round.honba}本场` : ''}`
}

/** 座位序 → 东南西北（供 UI 显示） */
export function seatLabel(i: number): string {
  return SEAT_ORDER[i] ?? '?'
}

/** 立直家文案：如 [true,false,false,false] -> '东'；[true,false,false,true] -> '东北'；全 false -> '' */
export function riichiText(riichi: boolean[] | null | undefined): string {
  return (riichi ?? [false, false, false, false])
    .map((v, i) => (v ? SEAT_ORDER[i] : ''))
    .join('')
}

/** 解析立直家文案（'东'/'东西'/'东南西北'/空 等）为四家布尔 */
export function parseRiichi(text: string): boolean[] {
  const out = [false, false, false, false]
  for (const ch of text.trim()) {
    const idx = SEAT_ORDER.indexOf(ch as (typeof SEAT_ORDER)[number])
    if (idx >= 0) out[idx] = true
  }
  return out
}
