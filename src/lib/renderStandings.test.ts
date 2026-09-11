import { describe, it, expect } from 'vitest'
import { esc, teamStyle, renderTeamTable, renderPlayerTable, standingsAsOf, activeStageFromGames } from './renderStandings'
import type { ComputedPlayerRow, ComputedTeamRow } from './standings'
import type { TeamInfo } from './types'

const teams: TeamInfo[] = [
  { name: '海盗', color: '#00CCFF' },
  { name: '樱花', color: '#F69ABF' },
  { name: '火山', color: '#5C5252' },
  { name: '雷电', color: '#FFFF00' },
]

const teamRow = (over: Partial<ComputedTeamRow>): ComputedTeamRow => ({
  rank: 1,
  team: '海盗',
  points: 100,
  carry: 0,
  stagePoints: 100,
  stageRaw: 50,
  games: 3,
  wins: { '1': 1, '2': 1, '3': 1, '4': 0 },
  diff: null,
  advDiff: 0,
  firstDiff: null,
  ...over,
})

const playerRow = (over: Partial<ComputedPlayerRow>): ComputedPlayerRow => ({
  rank: 1,
  team: '海盗',
  name: 'Art3mis',
  points: 100,
  rawPoints: 50,
  penalty: 0,
  wins: { '1': 1, '2': 1, '3': 1, '4': 0 },
  maxScore: 42000,
  games: 3,
  avgRank: 2,
  winRate: 1 / 3,
  pairRate: 2 / 3,
  avoidRate: 1,
  ...over,
})

describe('esc / teamStyle', () => {
  it('转义 HTML 特殊字符', () => {
    expect(esc('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;')
  })
  it('深色队伍白字，浅色队伍深字', () => {
    expect(teamStyle('海盗', teams)).toBe('background:#00CCFF;color:#fff')
    expect(teamStyle('樱花', teams)).toBe('background:#F69ABF;color:#1f2328')
  })
})

describe('renderTeamTable', () => {
  it('常规赛表头含 素点/晋级线差，行含积分与 pts 标注', () => {
    const html = renderTeamTable('常规赛', [teamRow({ rank: 1 })], teams, 24)
    expect(html).toContain('晋级线差')
    expect(html).toContain('素点')
    expect(html).toContain('class="num col-pts"')
    expect(html).toContain('<span class="pts-label">pts</span>')
    expect(html).toContain('class="table-wrap team-table stage-常规赛"')
    expect(html).toContain('<span class="games-num">3</span><span class="games-total">/24</span>')
    expect(html).toContain('<span class="pts-val">100.0</span>')
    expect(html).toContain('<td class="num raw">50.0</td>')
  })
  it('半决赛表头含 半决赛积分/持越，无素点列', () => {
    const html = renderTeamTable('半决赛', [teamRow({ rank: 1 })], teams, 4)
    expect(html).toContain('半决赛积分')
    expect(html).toContain('持越')
    expect(html).not.toContain('>素点<')
  })
  it('决赛用一位差，含晋级分隔线行', () => {
    const html = renderTeamTable('决赛', [teamRow({ rank: 1 }), teamRow({ rank: 2, team: '樱花', diff: 20, firstDiff: -20 })], teams, 2)
    expect(html).toContain('一位差')
    expect(html).not.toContain('晋级线差')
  })
})

describe('renderPlayerTable', () => {
  it('生成 data-href 链接到档案锚点', () => {
    const html = renderPlayerTable([playerRow()], teams, '/PKUMLonline/')
    expect(html).toContain('data-href="/PKUMLonline/archive#player-Art3mis"')
  })
  it('负分带 neg，比率按百分比格式化', () => {
    const html = renderPlayerTable([playerRow({ points: -88, rawPoints: 24, penalty: -5, winRate: 0.5 })], teams, '/')
    expect(html).toContain('class="neg"')
    expect(html).toContain('>-88.0</span>')
    expect(html).toContain('<td class="num raw">24.0</td>')
    expect(html).toContain('<span class="penalty">-5.0</span>')
    expect(html).toContain('50.0%')
    expect(html).toContain('<td class="num">42000</td>')
  })
  it('队伍列带底色与深浅字', () => {
    const html = renderPlayerTable([playerRow({ team: '雷电' })], teams, '/')
    expect(html).toContain('background:#FFFF00;color:#1f2328')
  })
})

describe('standingsAsOf / activeStageFromGames', () => {
  it('由最新完赛日期生成 asOf', () => {
    expect(standingsAsOf([{ date: '2026-09-05' }, { date: '2026-09-12' }])).toBe('9月12日终了时点')
    expect(standingsAsOf([])).toBeNull()
  })
  it('含半庄号：最新对局日期 + 第N半庄', () => {
    expect(standingsAsOf([
      { date: '2026-09-01', round: '第1半庄' },
      { date: '2026-09-01', round: '第2半庄' },
    ])).toBe('9月1日第2半庄终了时点')
  })
  it('取最后一个有完赛的阶段', () => {
    const games = [{ stage: '常规赛' }, { stage: '常规赛' }, { stage: '半决赛' }]
    expect(activeStageFromGames(games, ['常规赛', '半决赛', '决赛'])).toBe('半决赛')
    expect(activeStageFromGames([], ['常规赛', '半决赛', '决赛'])).toBeNull()
  })
})
