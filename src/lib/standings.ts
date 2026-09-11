import type { PlayerBoardRow, StageStandings, TeamBoardRow, Wins } from './types'

export function gamesPlayed(w: Wins): number {
  return w['1'] + w['2'] + w['3'] + w['4']
}

export function avgRank(w: Wins, games: number): number | null {
  if (games === 0) return null
  return (w['1'] * 1 + w['2'] * 2 + w['3'] * 3 + w['4'] * 4) / games
}

export function rate(num: number, games: number): number | null {
  if (games === 0) return null
  return num / games
}

export function formatPct(x: number | null): string {
  if (x == null) return '-'
  return `${(x * 100).toFixed(1)}%`
}

export function formatScore(n: number | null): string {
  if (n == null) return '-'
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export function formatPt(n: number | null): string {
  if (n == null) return '-'
  return n.toFixed(1)
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10
}

// 当前进行中的阶段名：赛季未开始返回 null；已开始则取第一个有榜单数据的阶段，
// 尚无数据时退回第一阶段（常规赛）。供首页与榜单页选择要展示的阶段榜。
export function activeStageName(
  season: { hasStarted: boolean },
  stages: StageStandings[],
): string | null {
  if (!season.hasStarted) return null
  const withData = stages.find((s) => s.teamBoard.length > 0 || s.playerBoard.length > 0)
  return withData?.name ?? stages[0]?.name ?? null
}

export interface ComputedTeamRow {
  rank: number
  team: string
  points: number
  carry: number
  stagePoints: number
  stageRaw: number
  games: number
  wins: Wins
  diff: number | null
  advDiff: number | null
  firstDiff: number | null
}

export function computeTeamBoard(rows: TeamBoardRow[], promoteRank: number, teamOrder?: string[]): ComputedTeamRow[] {
  const orderIdx = new Map((teamOrder ?? []).map((t, i) => [t, i]))
  const sorted = [...rows]
    .map(r => ({ ...r, points: r.carry + r.stagePoints }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points
      if (teamOrder) {
        // 同分按固定队伍次序（海盗、格斗、樱花、火山、野兽、地球、凤凰、雷电、赤坂、AB）
        return (orderIdx.get(a.team) ?? 999) - (orderIdx.get(b.team) ?? 999)
      }
      return b.stageRaw - a.stageRaw || a.team.localeCompare(b.team, 'zh')
    })
  const linePoints = promoteRank > 0 && sorted.length >= promoteRank ? sorted[promoteRank - 1].points : null
  const firstOutPoints = promoteRank > 0 && sorted.length > promoteRank ? sorted[promoteRank].points : null
  const leader = sorted.length > 0 ? sorted[0].points : null
  return sorted.map((r, i) => {
    const prev = i > 0 ? sorted[i - 1].points : null
    return {
      rank: i + 1,
      team: r.team,
      points: r.points,
      carry: r.carry,
      stagePoints: r.stagePoints,
      stageRaw: r.stageRaw,
      games: gamesPlayed(r.wins),
      wins: r.wins,
      diff: prev == null ? null : round1(prev - r.points),
      advDiff: linePoints == null || firstOutPoints == null
        ? null
        : round1(i < promoteRank ? r.points - firstOutPoints : r.points - linePoints),
      firstDiff: leader == null || i === 0 ? null : round1(r.points - leader),
    }
  })
}

export interface ComputedPlayerRow extends PlayerBoardRow {
  rank: number
  games: number
  avgRank: number | null
  winRate: number | null
  pairRate: number | null
  avoidRate: number | null
}

export interface PlayerBoardOptions {
  /** 固定队伍次序（同分先比队伍次序） */
  teamOrder?: string[]
  /** 指名顺序：选手名 -> 队内指名序号（同队同分按此排序） */
  rosterIndex?: Map<string, number>
}

export function computePlayerBoard(rows: PlayerBoardRow[], opts?: PlayerBoardOptions): ComputedPlayerRow[] {
  const teamIdx = new Map((opts?.teamOrder ?? []).map((t, i) => [t, i]))
  const sorted = [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (opts?.teamOrder) {
      const ti = (teamIdx.get(a.team) ?? 999) - (teamIdx.get(b.team) ?? 999)
      if (ti !== 0) return ti
      if (opts.rosterIndex) {
        const ri = (opts.rosterIndex.get(a.name) ?? 999) - (opts.rosterIndex.get(b.name) ?? 999)
        if (ri !== 0) return ri
      }
      return a.name.localeCompare(b.name, 'zh')
    }
    return b.rawPoints - a.rawPoints || a.name.localeCompare(b.name, 'zh')
  })
  return sorted.map((r, i) => {
    const games = gamesPlayed(r.wins)
    return {
      ...r,
      rank: i + 1,
      games,
      avgRank: avgRank(r.wins, games),
      winRate: rate(r.wins['1'], games),
      pairRate: rate(r.wins['1'] + r.wins['2'], games),
      avoidRate: rate(r.wins['1'] + r.wins['2'] + r.wins['3'], games),
    }
  })
}
