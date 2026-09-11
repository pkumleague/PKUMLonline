/**
 * 对局计算引擎（纯函数）：局名/本场/亲家推进 + 每小局点数结算。
 * 规则依据 docs/superpowers/specs/2026-08-13-admin-backend-design.md：
 * - 本场费 = 本场数 × 300；供托 = 累计立直棒 × 1000（荒牌流局保留、和了清零）
 * - 荣和：赢家 +基础点+本场费；放铳者 −基础点−本场费；赢家收供托池，池清零
 * - 自摸：赢家 +基础点总额（支付拆分来自点数表）；本场费赢家 +300×本场、三家各 −100×本场；赢家收供托池清零
 * - 荒牌流局：罚符（听牌 1/2/3 人，总额固定 3000）；本场 +1；供托保留
 * - 局推进：亲家和牌或亲家听牌流局 → 连庄本场+1；亲家未听牌流局 → 推进本场+1；子家和牌 → 推进本场归 0
 * - 亲家 = 局名对应初始座位（东1/南1=东起，东2/南2=南起，东3/南3=西起，东4/南4=北起）
 * - 不变量：每小局四家增减和 + 供托池变化 = 0
 */

export type Wind = '东' | '南'
export type SeatWind = '东' | '南' | '西' | '北'

export interface RoundState {
  wind: Wind
  number: 1 | 2 | 3 | 4
  honba: number
}

export type WinType = 'ron' | 'tsumo' | 'draw'

export interface RoundResult {
  winType: WinType
  /** 本小局立直宣告（4 位，与座位序对应） */
  riichi: boolean[]
  /** 荣和/自摸赢家座位（0-3：东南西北） */
  winner?: number
  /** 荣和放铳座位 */
  loser?: number
  /** 荣和基础点数 */
  ronPoints?: number
  /** 自摸各家支付（赢家为 0；子家自摸 [子付,亲付,…]，亲家自摸 [各付,…]） */
  tsumoPayments?: number[]
  /** 荒牌流局四家听牌（4 位） */
  tenpai?: boolean[]
}

export interface Settlement {
  /** 四家本小局增减（含立直/和了/流局/本场费） */
  deltas: number[]
  /** 结算后供托棒数 */
  poolAfter: number
}

/** 亲家座位：局名对应初始座位（东1/南1=东起，东2/南2=南起，…） */
export function dealerSeat(round: RoundState): number {
  return round.number - 1
}

/** 当前局某位选手的风位；playerIndex 为半庄开始时的东南西北顺序。 */
export function currentSeatWind(round: RoundState, playerIndex: number): SeatWind {
  return seatWindFromDealer(playerIndex, dealerSeat(round))
}

/** 按当前亲家索引计算某位选手的风位，供直播 UI 与亲家标记同步。 */
export function seatWindFromDealer(playerIndex: number, dealer: number): SeatWind {
  const winds: SeatWind[] = ['东', '南', '西', '北']
  return winds[(playerIndex - dealer + 4) % 4]
}

/** 是否为连庄（亲家和牌或亲家听牌流局） */
export function isRenchan(round: RoundState, result: RoundResult): boolean {
  if (result.winType === 'ron' || result.winType === 'tsumo') {
    return result.winner === dealerSeat(round)
  }
  return result.tenpai?.[dealerSeat(round)] ?? false
}

function advance(prev: RoundState, honba: number): RoundState | null {
  if (prev.wind === '南' && prev.number === 4) return null // 南四推进 → 半庄结束
  if (prev.number === 4) return { wind: '南', number: 1, honba }
  return { wind: prev.wind, number: (prev.number + 1) as RoundState['number'], honba }
}

/** 下一局状态：连庄本场+1；子家和牌推进本场归 0；亲家未听牌流局推进本场+1；南四推进返回 null（半庄结束） */
export function nextRound(prev: RoundState, result: RoundResult): RoundState | null {
  if (isRenchan(prev, result)) {
    return { wind: prev.wind, number: prev.number, honba: prev.honba + 1 }
  }
  if (result.winType === 'ron' || result.winType === 'tsumo') {
    return advance(prev, 0) // 子家和牌
  }
  return advance(prev, prev.honba + 1) // 亲家未听牌流局
}

/** 本场费 = 本场数 × 300 */
export function honbaFeeOf(round: RoundState): number {
  return round.honba * 300
}

/**
 * 每小局结算。
 * @param poolBefore 本小局开始前供托棒数（跨局保留）
 */
export function settleRound(
  round: RoundState,
  result: RoundResult,
  poolBefore: number,
): Settlement {
  const deltas = [0, 0, 0, 0]
  let pool = poolBefore

  // 立直宣告：立直者 −1000，入供托池
  for (let i = 0; i < 4; i++) {
    if (result.riichi[i]) {
      deltas[i] -= 1000
      pool += 1
    }
  }

  const honbaFee = honbaFeeOf(round)

  if (result.winType === 'ron') {
    const w = result.winner!
    const l = result.loser!
    const base = result.ronPoints!
    deltas[w] += base + honbaFee
    deltas[l] -= base + honbaFee
    if (pool > 0) {
      deltas[w] += pool * 1000
      pool = 0
    }
  } else if (result.winType === 'tsumo') {
    const w = result.winner!
    const pays = result.tsumoPayments!
    for (let i = 0; i < 4; i++) {
      if (i === w) continue
      deltas[i] -= pays[i]
      deltas[w] += pays[i]
    }
    deltas[w] += honbaFee
    for (let i = 0; i < 4; i++) {
      if (i !== w) deltas[i] -= 100 * round.honba
    }
    if (pool > 0) {
      deltas[w] += pool * 1000
      pool = 0
    }
  } else {
    // 荒牌流局：罚符（0 或 4 家听牌无罚符），供托保留
    const tp = result.tenpai!
    const n = tp.filter(Boolean).length
    if (n === 1) {
      tp.forEach((t, i) => { deltas[i] += t ? 3000 : -1000 })
    } else if (n === 2) {
      tp.forEach((t, i) => { deltas[i] += t ? 1500 : -1500 })
    } else if (n === 3) {
      tp.forEach((t, i) => { deltas[i] += t ? 1000 : -3000 })
    }
  }

  return { deltas, poolAfter: pool }
}
