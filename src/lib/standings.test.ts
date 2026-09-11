import { describe, it, expect } from 'vitest'
import { avgRank, rate, formatPct, formatPt, formatScore, computeTeamBoard, computePlayerBoard, activeStageName } from './standings'
import type { PlayerBoardRow, StageStandings, TeamBoardRow } from './types'

describe('avgRank', () => {
  it('计算加权平均顺位', () => {
    const w = { '1': 1, '2': 2, '3': 1, '4': 0 }
    expect(avgRank(w, 4)).toBe(2)
  })
  it('无比赛时返回 null', () => {
    expect(avgRank({ '1': 0, '2': 0, '3': 0, '4': 0 }, 0)).toBeNull()
  })
})

describe('rate', () => {
  it('计算比率', () => {
    expect(rate(2, 4)).toBe(0.5)
  })
  it('无比赛时返回 null', () => {
    expect(rate(0, 0)).toBeNull()
  })
})

describe('formatPct', () => {
  it('比率转百分比字符串', () => {
    expect(formatPct(0.8333)).toBe('83.3%')
  })
  it('null 显示 -', () => {
    expect(formatPct(null)).toBe('-')
  })
})

describe('formatScore', () => {
  it('整数不带小数点', () => {
    expect(formatScore(42000)).toBe('42000')
  })
  it('小数保留一位', () => {
    expect(formatScore(-89.3)).toBe('-89.3')
  })
  it('null 显示 -', () => {
    expect(formatScore(null)).toBe('-')
  })
})

describe('formatPt', () => {
  it('整数固定保留一位小数', () => {
    expect(formatPt(24)).toBe('24.0')
  })
  it('小数保留一位', () => {
    expect(formatPt(-89.3)).toBe('-89.3')
  })
  it('null 显示 -', () => {
    expect(formatPt(null)).toBe('-')
  })
})

describe('computeTeamBoard', () => {
  const rows: TeamBoardRow[] = [
    { team: '海盗', carry: 0, stagePoints: 120, stageRaw: 1000, wins: { '1': 5, '2': 3, '3': 2, '4': 2 } },
    { team: '格斗', carry: 0, stagePoints: 90, stageRaw: 2000, wins: { '1': 4, '2': 4, '3': 3, '4': 1 } },
    { team: '樱花', carry: 0, stagePoints: 120, stageRaw: 800, wins: { '1': 5, '2': 2, '3': 3, '4': 2 } },
  ]
  it('按积分降序、素点降序排序', () => {
    const board = computeTeamBoard(rows, 2)
    expect(board.map(r => r.team)).toEqual(['海盗', '樱花', '格斗'])
  })
  it('计算与上一名的差（第1名为 -）', () => {
    const board = computeTeamBoard(rows, 2)
    expect(board[0].diff).toBeNull()
    expect(board[1].diff).toBe(0)
    expect(board[2].diff).toBe(30)
  })
  it('计算与晋级线名次的差（线上与线下第一名比，线下与线上最后一名比）', () => {
    const board = computeTeamBoard(rows, 2)
    expect(board[0].advDiff).toBe(30)
    expect(board[1].advDiff).toBe(30)
    expect(board[2].advDiff).toBe(-30)
  })
  it('计算与第1名的差（第1名为 -）', () => {
    const board = computeTeamBoard(rows, 2)
    expect(board[0].firstDiff).toBeNull()
    expect(board[1].firstDiff).toBe(0)
    expect(board[2].firstDiff).toBe(-30)
  })
  it('积分 = 持越 + 本阶段积分', () => {
    const withCarry: TeamBoardRow[] = [
      { team: '海盗', carry: 50, stagePoints: 70, stageRaw: 100, wins: { '1': 1, '2': 0, '3': 0, '4': 0 } },
    ]
    const board = computeTeamBoard(withCarry, 0)
    expect(board[0].points).toBe(120)
  })
  it('空数组返回空数组', () => {
    expect(computeTeamBoard([], 6)).toEqual([])
  })
})

describe('computeTeamBoard 固定队伍次序', () => {
  const order = ['海盗', '格斗', '樱花', '火山', '野兽', '地球', '凤凰', '雷电', '赤坂', 'AB']
  it('同分按固定队伍次序显示，素点不再作为同分次序依据', () => {
    const rows: TeamBoardRow[] = [
      { team: '樱花', carry: 0, stagePoints: 100, stageRaw: 900, wins: { '1': 1, '2': 0, '3': 0, '4': 0 } },
      { team: '格斗', carry: 0, stagePoints: 100, stageRaw: 1200, wins: { '1': 1, '2': 0, '3': 0, '4': 0 } },
      { team: '海盗', carry: 0, stagePoints: 100, stageRaw: 800, wins: { '1': 1, '2': 0, '3': 0, '4': 0 } },
      { team: 'AB', carry: 0, stagePoints: 80, stageRaw: 500, wins: { '1': 0, '2': 1, '3': 0, '4': 0 } },
    ]
    const board = computeTeamBoard(rows, 6, order)
    expect(board.map((r) => r.team)).toEqual(['海盗', '格斗', '樱花', 'AB'])
  })
  it('不传 teamOrder 时保持素点优先的旧行为', () => {
    const rows: TeamBoardRow[] = [
      { team: '樱花', carry: 0, stagePoints: 100, stageRaw: 900, wins: { '1': 1, '2': 0, '3': 0, '4': 0 } },
      { team: '海盗', carry: 0, stagePoints: 100, stageRaw: 800, wins: { '1': 1, '2': 0, '3': 0, '4': 0 } },
    ]
    const board = computeTeamBoard(rows, 6)
    expect(board.map((r) => r.team)).toEqual(['樱花', '海盗'])
  })
})

describe('computePlayerBoard 指名顺序', () => {
  const order = ['海盗', '格斗', '樱花', '火山', '野兽', '地球', '凤凰', '雷电', '赤坂', 'AB']
  const rosterIndex = new Map([['微汐', 0], ['(1)', 1], ['(10)', 2], ['(14)', 3]])
  it('同队同分按指名顺序；不同队同分按队伍次序', () => {
    const rows: PlayerBoardRow[] = [
      { team: 'AB', name: '(10)', points: 50, rawPoints: 300, penalty: 0, wins: { '1': 1, '2': 0, '3': 0, '4': 0 }, maxScore: 40000 },
      { team: 'AB', name: '微汐', points: 50, rawPoints: 100, penalty: 0, wins: { '1': 1, '2': 0, '3': 0, '4': 0 }, maxScore: 40000 },
      { team: '海盗', name: 'Art3mis', points: 50, rawPoints: 900, penalty: 0, wins: { '1': 1, '2': 0, '3': 0, '4': 0 }, maxScore: 40000 },
    ]
    const board = computePlayerBoard(rows, { teamOrder: order, rosterIndex })
    expect(board.map((r) => r.name)).toEqual(['Art3mis', '微汐', '(10)'])
  })
})

describe('activeStageName', () => {
  const empty = (name: string): StageStandings => ({ name, teamBoard: [], playerBoard: [] })
  const withTeam = (name: string): StageStandings => ({
    name,
    teamBoard: [{ team: '海盗', carry: 0, stagePoints: 0, stageRaw: 0, wins: { '1': 0, '2': 0, '3': 0, '4': 0 } }],
    playerBoard: [],
  })
  it('赛季未开始返回 null', () => {
    expect(activeStageName({ hasStarted: false }, [empty('常规赛'), empty('半决赛'), empty('决赛')])).toBeNull()
  })
  it('已开始但无数据时退回第一阶段', () => {
    expect(activeStageName({ hasStarted: true }, [empty('常规赛'), empty('半决赛'), empty('决赛')])).toBe('常规赛')
  })
  it('已开始且半决赛有数据时返回半决赛', () => {
    expect(activeStageName({ hasStarted: true }, [empty('常规赛'), withTeam('半决赛'), empty('决赛')])).toBe('半决赛')
  })
})

describe('computePlayerBoard', () => {
  const rows: PlayerBoardRow[] = [
    { team: '海盗', name: '甲', points: 50, rawPoints: 300, penalty: 0, wins: { '1': 2, '2': 1, '3': 0, '4': 1 }, maxScore: 40000 },
    { team: '格斗', name: '乙', points: 80, rawPoints: 200, penalty: 5, wins: { '1': 3, '2': 0, '3': 1, '4': 0 }, maxScore: 45000 },
  ]
  it('按积分降序排序', () => {
    const board = computePlayerBoard(rows)
    expect(board.map(r => r.name)).toEqual(['乙', '甲'])
  })
  it('计算平均顺位、一位率、连对率、避四率', () => {
    const board = computePlayerBoard(rows)
    const a = board[1]
    expect(a.avgRank).toBe(2)
    expect(a.winRate).toBe(0.5)
    expect(a.pairRate).toBe(0.75)
    expect(a.avoidRate).toBe(0.75)
  })
  it('比赛数由位次次数求和', () => {
    const board = computePlayerBoard(rows)
    expect(board[1].games).toBe(4)
  })
})
