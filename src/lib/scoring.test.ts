import { describe, it, expect } from 'vitest'
import { currentSeatWind, dealerSeat, isRenchan, nextRound, honbaFeeOf, settleRound } from './scoring'
import type { RoundResult, RoundState } from './scoring'

const r = (over: Partial<RoundState> = {}): RoundState => ({ wind: '东', number: 1, honba: 0, ...over })
const result = (over: Partial<RoundResult>): RoundResult => ({ winType: 'ron', riichi: [false, false, false, false], ...over })

describe('dealerSeat', () => {
  it('局名对应初始座位', () => {
    expect(dealerSeat(r({ wind: '东', number: 1 }))).toBe(0)
    expect(dealerSeat(r({ wind: '东', number: 2 }))).toBe(1)
    expect(dealerSeat(r({ wind: '东', number: 3 }))).toBe(2)
    expect(dealerSeat(r({ wind: '东', number: 4 }))).toBe(3)
    expect(dealerSeat(r({ wind: '南', number: 1 }))).toBe(0)
    expect(dealerSeat(r({ wind: '南', number: 3 }))).toBe(2)
  })
})

describe('currentSeatWind', () => {
  it.each([
    ['东', 1, ['东', '南', '西', '北']],
    ['东', 2, ['北', '东', '南', '西']],
    ['东', 3, ['西', '北', '东', '南']],
    ['东', 4, ['南', '西', '北', '东']],
    ['南', 1, ['东', '南', '西', '北']],
    ['南', 2, ['北', '东', '南', '西']],
    ['南', 3, ['西', '北', '东', '南']],
    ['南', 4, ['南', '西', '北', '东']],
  ] as const)('%s%d局显示当前风位', (wind, number, expected) => {
    expect([0, 1, 2, 3].map((i) => currentSeatWind(r({ wind, number }), i))).toEqual(expected)
  })
})

describe('isRenchan / nextRound', () => {
  it('子家和牌：推进，本场归 0', () => {
    const next = nextRound(r({ number: 1, honba: 2 }), result({ winType: 'ron', winner: 1 }))
    expect(next).toEqual({ wind: '东', number: 2, honba: 0 })
  })
  it('亲家和牌：连庄，本场 +1', () => {
    const next = nextRound(r({ number: 1, honba: 2 }), result({ winType: 'ron', winner: 0 }))
    expect(next).toEqual({ wind: '东', number: 1, honba: 3 })
  })
  it('亲家自摸：连庄，本场 +1', () => {
    expect(isRenchan(r({ number: 2 }), result({ winType: 'tsumo', winner: 1 }))).toBe(true)
  })
  it('亲家听牌流局：连庄，本场 +1（东2 亲家=座位1）', () => {
    const next = nextRound(r({ number: 2, honba: 1 }), result({ winType: 'draw', tenpai: [false, true, false, false] }))
    expect(next).toEqual({ wind: '东', number: 2, honba: 2 })
  })
  it('亲家未听牌流局：推进，本场 +1（东2 亲家=座位1，座位0听牌）', () => {
    const next = nextRound(r({ number: 2, honba: 1 }), result({ winType: 'draw', tenpai: [true, false, false, false] }))
    expect(next).toEqual({ wind: '东', number: 3, honba: 2 })
  })
  it('东4 子家和牌：进入南1，本场归 0（东4 亲家=座位3，座位2和牌）', () => {
    const next = nextRound(r({ number: 4, honba: 1 }), result({ winType: 'ron', winner: 2 }))
    expect(next).toEqual({ wind: '南', number: 1, honba: 0 })
  })
  it('南4 子家和牌：半庄结束返回 null（南4 亲家=座位3，座位2和牌）', () => {
    expect(nextRound(r({ wind: '南', number: 4 }), result({ winType: 'ron', winner: 2 }))).toBeNull()
  })
  it('南4 亲家和牌：连庄可继续', () => {
    const next = nextRound(r({ wind: '南', number: 4, honba: 0 }), result({ winType: 'ron', winner: 3 }))
    expect(next).toEqual({ wind: '南', number: 4, honba: 1 })
  })
  it('南4 亲家听牌流局：连庄可继续', () => {
    const next = nextRound(r({ wind: '南', number: 4, honba: 0 }), result({ winType: 'draw', tenpai: [false, false, false, true] }))
    expect(next).toEqual({ wind: '南', number: 4, honba: 1 })
  })
})

describe('honbaFeeOf', () => {
  it('本场费 = 本场数 × 300', () => {
    expect(honbaFeeOf(r({ honba: 0 }))).toBe(0)
    expect(honbaFeeOf(r({ honba: 2 }))).toBe(600)
  })
})

describe('settleRound · 荣和', () => {
  it('无本场无立直：赢家 +基础点，放铳者 −基础点', () => {
    const s = settleRound(r(), result({ winner: 0, loser: 2, ronPoints: 1000 }), 0)
    expect(s.deltas).toEqual([1000, 0, -1000, 0])
    expect(s.poolAfter).toBe(0)
  })
  it('本场 1：加减本场费 300', () => {
    const s = settleRound(r({ honba: 1 }), result({ winner: 0, loser: 2, ronPoints: 1000 }), 0)
    expect(s.deltas).toEqual([1300, 0, -1300, 0])
  })
  it('场上有 2 本供托：赢家收 2000，池清零', () => {
    const s = settleRound(r({ honba: 1 }), result({ winner: 0, loser: 2, ronPoints: 1000 }), 2)
    expect(s.deltas).toEqual([3300, 0, -1300, 0])
    expect(s.poolAfter).toBe(0)
  })
  it('本小局立直宣告：立直者 −1000 入池，和了后赢家收回', () => {
    const s = settleRound(r(), result({ riichi: [false, true, false, false], winner: 0, loser: 2, ronPoints: 1000 }), 0)
    expect(s.deltas).toEqual([2000, -1000, -1000, 0])
    expect(s.poolAfter).toBe(0)
  })
  it('平衡不变量：增减和 + 池变化 = 0', () => {
    const s = settleRound(r({ honba: 2 }), result({ riichi: [true, true, false, false], winner: 1, loser: 3, ronPoints: 3900 }), 1)
    expect(s.deltas.reduce((a, b) => a + b, 0) + (s.poolAfter - 1) * 1000).toBe(0)
  })
})

describe('settleRound · 自摸', () => {
  it('子家自摸 30符1番（300/500，赢家座位0）', () => {
    const s = settleRound(r(), result({ winType: 'tsumo', winner: 0, tsumoPayments: [0, 300, 500, 300] }), 0)
    expect(s.deltas).toEqual([1100, -300, -500, -300])
    expect(s.poolAfter).toBe(0)
  })
  it('本场 1：赢家 +300，三家各 −100', () => {
    const s = settleRound(r({ honba: 1 }), result({ winType: 'tsumo', winner: 0, tsumoPayments: [0, 300, 500, 300] }), 0)
    expect(s.deltas).toEqual([1400, -400, -600, -400])
  })
  it('亲家自摸（各付 700），赢家座位 2', () => {
    const s = settleRound(r({ number: 3 }), result({ winType: 'tsumo', winner: 2, tsumoPayments: [700, 700, 0, 700] }), 0)
    expect(s.deltas).toEqual([-700, -700, 2100, -700])
  })
  it('自摸收供托池', () => {
    const s = settleRound(r(), result({ winType: 'tsumo', winner: 0, tsumoPayments: [0, 300, 500, 300] }), 3)
    expect(s.deltas).toEqual([4100, -300, -500, -300])
    expect(s.poolAfter).toBe(0)
  })
})

describe('settleRound · 荒牌流局', () => {
  it('听牌 1 人：+3000 / 各 −1000', () => {
    const s = settleRound(r(), result({ winType: 'draw', tenpai: [true, false, false, false] }), 0)
    expect(s.deltas).toEqual([3000, -1000, -1000, -1000])
  })
  it('听牌 2 人：各 +1500 / 各 −1500', () => {
    const s = settleRound(r(), result({ winType: 'draw', tenpai: [true, false, true, false] }), 0)
    expect(s.deltas).toEqual([1500, -1500, 1500, -1500])
  })
  it('听牌 3 人：各 +1000 / −3000', () => {
    const s = settleRound(r(), result({ winType: 'draw', tenpai: [true, true, true, false] }), 0)
    expect(s.deltas).toEqual([1000, 1000, 1000, -3000])
  })
  it('听牌 0 或 4 人：无罚符', () => {
    expect(settleRound(r(), result({ winType: 'draw', tenpai: [false, false, false, false] }), 0).deltas).toEqual([0, 0, 0, 0])
    expect(settleRound(r(), result({ winType: 'draw', tenpai: [true, true, true, true] }), 0).deltas).toEqual([0, 0, 0, 0])
  })
  it('流局立直棒保留在池中', () => {
    const s = settleRound(r(), result({ winType: 'draw', riichi: [false, true, false, false], tenpai: [false, false, false, false] }), 2)
    expect(s.deltas).toEqual([0, -1000, 0, 0])
    expect(s.poolAfter).toBe(3)
  })
  it('平衡不变量：增减和 + 池变化 = 0', () => {
    const s = settleRound(r({ honba: 1 }), result({ winType: 'draw', riichi: [false, true, false, true], tenpai: [false, true, true, false] }), 0)
    expect(s.deltas.reduce((a, b) => a + b, 0) + (s.poolAfter - 0) * 1000).toBe(0)
  })
})
