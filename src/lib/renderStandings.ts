import { formatPct, formatPt, formatScore } from './standings'
import type { ComputedPlayerRow, ComputedTeamRow } from './standings'
import type { TeamInfo, Wins } from './types'

/**
 * 客户端榜单渲染：与 TeamStandingsTable / PlayerStandingsTable 组件同构的 HTML 生成，
 * 复用 global.css 中已有的表格样式类。供 /standings 与首页客户端拉取 DB 后渲染。
 */

const LIGHT_TEAMS = new Set(['樱花', '雷电', '赤坂', '凤凰', 'AB'])

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
}

export function teamStyle(name: string, teams: TeamInfo[]): string {
  const color = teams.find((t) => t.name === name)?.color ?? '#9ca3af'
  const text = LIGHT_TEAMS.has(name) ? '#1f2328' : '#fff'
  return `background:${color};color:${text}`
}

const HEADERS: Record<string, string[]> = {
  常规赛: ['顺位', '队伍', '积分', '素点', '差', '晋级线差', '场次', '1位', '2位', '3位', '4位'],
  半决赛: ['顺位', '队伍', '积分', '半决赛积分', '持越', '差', '晋级线差', '场次', '1位', '2位', '3位', '4位'],
  决赛: ['顺位', '队伍', '积分', '决赛积分', '持越', '差', '一位差', '场次', '1位', '2位', '3位', '4位'],
}

function promoteRankOf(stage: string): number {
  return stage === '常规赛' ? 6 : stage === '半决赛' ? 4 : 0
}

function rankClass(stage: string, rank: number): string {
  const c = ['rank', 'col-rank-t']
  if (stage === '常规赛') {
    if (rank <= 4) c.push('rank-safe')
    else if (rank <= 6) c.push('rank-bubble')
    else c.push('rank-out')
  } else if (stage === '半决赛') {
    if (rank <= 4) c.push('rank-safe')
    else c.push('rank-out')
  } else if (stage === '决赛') {
    if (rank === 1) c.push('rank-bubble')
  }
  return c.join(' ')
}

function teamNameHtml(name: string): string {
  return /^[一-鿿]{2}$/.test(name)
    ? `${esc(name[0])}<span class="team-sep"> </span>${esc(name[1])}`
    : esc(name)
}

const sumWins = (w: Wins) => w['1'] + w['2'] + w['3'] + w['4']
const fmt = (n: number | null) => formatPt(n)
const fmtSigned = (n: number | null) => (n == null ? '-' : n > 0 ? `+${formatPt(n)}` : formatPt(n))

export function renderTeamTable(
  stage: string,
  rows: ComputedTeamRow[],
  teams: TeamInfo[],
  totalGames: number,
): string {
  const header = HEADERS[stage] ?? HEADERS['常规赛']
  const promoteRank = promoteRankOf(stage)
  const thead = header
    .map((h, i) => {
      const cls = [
        i >= header.length - 4 ? 'col-w' : '',
        h === '差' || h === '晋级线差' || h === '一位差' ? 'col-diff' : '',
      ].filter(Boolean).join(' ')
      return `<th${cls ? ` class="${cls}"` : ''}>${h}</th>`
    })
    .join('')
  const body = rows
    .map((r) => {
      const neg = r.points < 0 ? ' neg' : ''
      const isSep = promoteRank > 0 && r.rank === promoteRank + 1
      const cells: string[] = []
      cells.push(`<td class="${rankClass(stage, r.rank)}">${r.rank}</td>`)
      cells.push(`<td class="team-col" style="${teamStyle(r.team, teams)}">${teamNameHtml(r.team)}</td>`)
      cells.push(
        `<td class="num col-pts"><span class="pts-val${neg}">${formatPt(r.points)}</span><span class="pts-label">pts</span></td>`,
      )
      if (stage !== '常规赛') cells.push(`<td class="num">${formatPt(r.stagePoints)}</td>`)
      if (stage !== '常规赛') cells.push(`<td class="num">${formatPt(r.carry)}</td>`)
      if (stage === '常规赛') cells.push(`<td class="num raw">${formatPt(r.stageRaw)}</td>`)
      cells.push(`<td class="num col-diff">${fmt(r.diff)}</td>`)
      cells.push(
        stage === '决赛'
          ? `<td class="num col-diff">${fmtSigned(r.firstDiff)}</td>`
          : `<td class="num col-diff">${fmtSigned(r.advDiff)}</td>`,
      )
      cells.push(
        `<td class="num col-games"><span class="games-num">${sumWins(r.wins)}</span><span class="games-total">/${totalGames}</span></td>`,
      )
      cells.push(`<td class="num col-w">${r.wins['1']}</td>`)
      cells.push(`<td class="num col-w">${r.wins['2']}</td>`)
      cells.push(`<td class="num col-w">${r.wins['3']}</td>`)
      cells.push(`<td class="num col-w">${r.wins['4']}</td>`)
      return `<tr${isSep ? ' class="sep"' : ''}>${cells.join('')}</tr>`
    })
    .join('')
  return `<div class="table-wrap team-table stage-${stage}"><table><thead><tr>${thead}</tr></thead><tbody>${body}</tbody></table></div>`
}

const num0 = (n: number | null | undefined) => (n == null || n === 0 ? '' : formatPt(n))
const win0 = (n: number) => (n === 0 ? '' : String(n))
const pct0 = (n: number | null | undefined) => (n == null || n === 0 ? '' : formatPct(n))

export function renderPlayerTable(rows: ComputedPlayerRow[], teams: TeamInfo[], base: string): string {
  const thead =
    '<tr>' +
    '<th>顺位</th><th>所属</th><th>选手名</th><th>积分</th><th>素点</th><th>判罚</th>' +
    '<th>场次</th><th class="col-avg"><span class="avg-full">平均顺位</span><span class="avg-short">平顺</span></th>' +
    '<th class="col-w">1位</th><th class="col-w">2位</th><th class="col-w">3位</th><th class="col-w">4位</th>' +
    '<th>一位率</th><th>连对率</th><th>避四率</th><th>最高分</th>' +
    '</tr>'
  const body = rows
    .map((r) => {
      const cells: string[] = []
      cells.push(`<td class="rank col-rank-p">${r.rank}</td>`)
      cells.push(`<td class="team-col" style="${teamStyle(r.team, teams)}">${esc(r.team)}</td>`)
      cells.push(`<td>${esc(r.name)}</td>`)
      cells.push(
        `<td class="num col-pts-p">${r.points < 0 ? `<span class="neg">${formatPt(r.points)}</span>` : num0(r.points)}</td>`,
      )
      cells.push(`<td class="num raw">${num0(r.rawPoints)}</td>`)
      cells.push(`<td class="num">${r.penalty ? `<span class="penalty">${formatPt(r.penalty)}</span>` : ''}</td>`)
      cells.push(`<td class="num">${win0(r.games)}</td>`)
      cells.push(`<td class="num col-avg">${r.avgRank == null ? '' : r.avgRank.toFixed(2)}</td>`)
      cells.push(`<td class="num col-w">${win0(r.wins['1'])}</td>`)
      cells.push(`<td class="num col-w">${win0(r.wins['2'])}</td>`)
      cells.push(`<td class="num col-w">${win0(r.wins['3'])}</td>`)
      cells.push(`<td class="num col-w">${win0(r.wins['4'])}</td>`)
      cells.push(`<td class="num">${pct0(r.winRate)}</td>`)
      cells.push(`<td class="num">${pct0(r.pairRate)}</td>`)
      cells.push(`<td class="num">${pct0(r.avoidRate)}</td>`)
      cells.push(`<td class="num">${r.maxScore ? formatScore(r.maxScore) : ''}</td>`)
      return `<tr data-href="${base}archive#player-${encodeURIComponent(r.name)}">${cells.join('')}</tr>`
    })
    .join('')
  return `<div class="table-wrap player-table"><table><thead>${thead}</thead><tbody>${body}</tbody></table></div>`
}

/** asOf 文案：取最新完赛对局（日期+半庄号），生成「M月D日第N半庄终了时点」（无半庄号则省略）；无完赛返回 null */
export function standingsAsOf(games: { date: string; round?: string }[]): string | null {
  const latest = [...games].sort(
    (a, b) => b.date.localeCompare(a.date) || roundNum(b) - roundNum(a),
  )[0]
  if (!latest) return null
  const m = Number(latest.date.slice(5, 7))
  const d = Number(latest.date.slice(8, 10))
  const n = roundNum(latest)
  return n > 0 ? `${m}月${d}日第${n}半庄终了时点` : `${m}月${d}日终了时点`
}

function roundNum(g: { round?: string }): number {
  return Number(g.round?.match(/(\d+)/)?.[1] ?? 0)
}

/** 当前进行中的阶段：取最后一个有完赛对局的阶段；无则 null */
export function activeStageFromGames(games: { stage: string }[], stageNames: string[]): string | null {
  for (let i = stageNames.length - 1; i >= 0; i--) {
    if (games.some((g) => g.stage === stageNames[i])) return stageNames[i]
  }
  return null
}
