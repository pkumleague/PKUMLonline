import { describe, it, expect } from 'vitest'
import { replayGame, roundLabel, seatLabel, riichiText, parseRiichi } from './replay'
import type { StoredRound } from './replay'

const round = (over: Partial<StoredRound>): StoredRound => ({
  order: 1,
  win_type: null,
  riichi: [false, false, false, false],
  ron_winner: null,
  ron_loser: null,
  ron_points: null,
  tsumo_winner: null,
  tsumo_points: null,
  tenpai: null,
  ...over,
})

describe('replayGame', () => {
  it('空 rounds：初始状态 东1局 25000 起', () => {
    const { current } = replayGame([])
    expect(current.round).toEqual({ wind: '东', number: 1, honba: 0 })
    expect(current.scores).toEqual([25000, 25000, 25000, 25000])
    expect(current.pool).toBe(0)
    expect(current.settled).toBe(0)
    expect(current.draft).toBeUndefined()
  })

  it('单小局荣和：累计分正确，进入下一局（东1亲家=东，子家南和牌）', () => {
    const { current, history } = replayGame([
      round({ order: 1, win_type: 'ron', ron_winner: '南', ron_loser: '北', ron_points: 1000 }),
    ])
    expect(history).toHaveLength(1)
    expect(history[0].scores).toEqual([25000, 26000, 25000, 24000])
    expect(current.round).toEqual({ wind: '东', number: 2, honba: 0 })
    expect(current.settled).toBe(1)
  })

  it('亲家连庄：局名不变本场 +1', () => {
    const { current } = replayGame([
      round({ order: 1, win_type: 'ron', ron_winner: '东', ron_loser: '北', ron_points: 1000 }),
      round({ order: 2, win_type: 'ron', ron_winner: '东', ron_loser: '南', ron_points: 2000 }),
    ])
    expect(current.round).toEqual({ wind: '东', number: 1, honba: 2 })
  })

  it('流局立直棒保留，听牌连庄判定正确（听牌1人 +3000，立直 −1000 叠加）', () => {
    const { current, history } = replayGame([
      round({ order: 1, win_type: 'draw', riichi: [false, true, false, false], tenpai: [false, true, false, false] }),
    ])
    // 南座位立直 −1000 + 听牌罚符 +3000 = 净 +2000；亲家（东）未听牌 → 推进；供托 1 保留
    expect(history[0].scores).toEqual([24000, 27000, 24000, 24000])
    expect(current.pool).toBe(1)
    expect(current.round).toEqual({ wind: '东', number: 2, honba: 1 })
  })

  it('自摸拆分回放：子家自摸 300/500（东1亲家=东，南为子家和牌）', () => {
    const { history } = replayGame([
      round({ order: 1, win_type: 'tsumo', tsumo_winner: '南', tsumo_points: [300, 500] }),
    ])
    // 东（亲家）付 500，西/北各付 300；南 +1100
    expect(history[0].scores).toEqual([24500, 26100, 24700, 24700])
  })

  it('亲家自摸：各付', () => {
    const { history } = replayGame([
      round({ order: 2, win_type: 'tsumo', tsumo_winner: '南', tsumo_points: [1000] }),
    ])
    // 东2局亲家=南：南 +3000，其余各 −1000
    expect(history[0].scores).toEqual([24000, 28000, 24000, 24000])
  })

  it('草稿局（win_type null）停止回放并返回 draft', () => {
    const { current } = replayGame([
      round({ order: 1, win_type: 'ron', ron_winner: '东', ron_loser: '北', ron_points: 1000 }),
      round({ order: 2, win_type: null, riichi: [false, false, true, false] }),
    ])
    expect(current.settled).toBe(1)
    expect(current.draft?.order).toBe(2)
    expect(current.draft?.riichi).toEqual([false, false, true, false])
    // 草稿不结算：分数停在上一局
    expect(current.scores).toEqual([26000, 25000, 25000, 24000])
  })

  it('手动覆盖四家增减：累计分按 override.deltas，池仍按规则跟踪', () => {
    const { current, history } = replayGame([
      round({
        order: 1,
        win_type: 'ron',
        riichi: [false, true, false, false],
        ron_winner: '东',
        ron_loser: '北',
        ron_points: 1000,
        override: { deltas: [2000, -500, 500, -2000], result: '荣和·东(手改)', points: 1500 },
      }),
    ])
    expect(history[0].deltas).toEqual([2000, -500, 500, -2000])
    expect(history[0].override?.result).toBe('荣和·东(手改)')
    expect(history[0].override?.points).toBe(1500)
    expect(history[0].scores).toEqual([27000, 24500, 25500, 23000])
    // 供托池仍按立直(南 −1000 → +1 棒)与荣和（池清零）跟踪
    expect(current.pool).toBe(0)
  })

  it('手动覆盖供托点数：展示值取 override.pool，下一局结算池仍按规则', () => {
    const { history, current } = replayGame([
      round({
        order: 1,
        win_type: 'ron',
        riichi: [false, true, false, false],
        ron_winner: '东',
        ron_loser: '北',
        ron_points: 1000,
        override: { pool: 5000 },
      }),
      round({ order: 2, win_type: 'ron', ron_winner: '南', ron_loser: '东', ron_points: 1000 }),
    ])
    expect(history[0].pool).toBe(5000) // 展示用手动值
    expect(history[1].pool).toBe(0) // 第2局结算池仍按规则（第1局荣和池清零）
    expect(current.pool).toBe(0)
  })

  it('live reset marker restarts calculation from a custom middle state', () => {
    const { current, history } = replayGame([
      round({ order: 1, win_type: 'ron', ron_winner: seatLabel(1), ron_loser: seatLabel(3), ron_points: 1000 }),
      {
        ...round({ order: 2 }),
        reset: {
          round: { wind: '东', number: 3, honba: 1 },
          pool: 2,
          scores: [30000, 20000, 25000, 23000],
        },
      },
      round({ order: 3, win_type: 'ron', ron_winner: seatLabel(2), ron_loser: seatLabel(3), ron_points: 1000 }),
    ])

    expect(history).toHaveLength(2)
    expect(history[1].round).toEqual({ wind: '东', number: 3, honba: 1 })
    expect(history[1].scores).toEqual([30000, 20000, 28300, 21700])
    expect(current.round).toEqual({ wind: '东', number: 3, honba: 2 })
    expect(current.pool).toBe(0)
  })

  it('南4 子家和牌后半庄结束：不再有下一局', () => {
    const dealers = [0, 1, 2, 3, 0, 1, 2, 3] // 东1-4、南1-4 的亲家座位
    const winners = [1, 0, 3, 0, 2, 3, 0, 1] // 每局由子家（非亲家）和牌 → 全部推进
    const rounds: StoredRound[] = winners.map((w, i) => ({
      ...round({
        order: i + 1,
        win_type: 'ron',
        ron_winner: seatLabel(w),
        ron_loser: seatLabel((w + 1) % 4),
        ron_points: 1000,
      }),
      // 校验：w 不是该局亲家
    }))
    expect(rounds.every((r, i) => r.ron_winner !== seatLabel(dealers[i]))).toBe(true)
    const { current, history } = replayGame(rounds)
    expect(history).toHaveLength(8)
    expect(history[7].round).toEqual({ wind: '南', number: 4, honba: 0 })
    expect(current.round).toEqual({ wind: '南', number: 4, honba: 0 })
    expect(current.settled).toBe(8)
  })
})

describe('roundLabel / seatLabel', () => {
  it('局名文案', () => {
    expect(roundLabel({ wind: '东', number: 1, honba: 0 })).toBe('东1局')
    expect(roundLabel({ wind: '南', number: 3, honba: 2 })).toBe('南3局 2本场')
  })
  it('座位文案', () => {
    expect(seatLabel(0)).toBe('东')
    expect(seatLabel(3)).toBe('北')
  })
})

describe('riichiText / parseRiichi', () => {
  it('立直家文案：东 / 东西 / 东南西北 / 空', () => {
    expect(riichiText([true, false, false, false])).toBe('东')
    expect(riichiText([true, false, true, false])).toBe('东西')
    expect(riichiText([true, true, true, true])).toBe('东南西北')
    expect(riichiText([false, false, false, false])).toBe('')
    expect(riichiText(null)).toBe('')
  })
  it('解析文案为四家布尔', () => {
    expect(parseRiichi('东')).toEqual([true, false, false, false])
    expect(parseRiichi('东西')).toEqual([true, false, true, false])
    expect(parseRiichi('东南西北')).toEqual([true, true, true, true])
    expect(parseRiichi('')).toEqual([false, false, false, false])
    expect(parseRiichi(' 北 ')).toEqual([false, false, false, true])
  })
})
