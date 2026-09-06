import type { StoredRound } from './replay'

export type TileSuit = 'm' | 'p' | 's' | 'z'

export interface Tile {
  code: string
  rank: string
  suit: TileSuit
}

export interface LiveOnlyData {
  doraByOrder: Record<string, string[]>
  waitsByOrder: Record<string, string[][]>
  scoreOverridesByOrder: Record<string, number[]>
}

export interface LiveExport {
  version: 1
  gameId: string
  exportedAt: string
  rounds: StoredRound[]
  liveOnly: LiveOnlyData
}

export interface LiveState {
  version: 1
  gameId: string
  game?: unknown
  rounds: StoredRound[]
  currentDora: string[]
  currentWaits: string[][]
  currentRiichi?: boolean[]
  scoreOverride: number[] | null
  liveOnly: LiveOnlyData
  updatedAt: string
}

export function liveStorageKey(gameId: string): string {
  return `pkuml-live:${gameId}`
}

export function emptyLiveOnly(): LiveOnlyData {
  return {
    doraByOrder: {},
    waitsByOrder: {},
    scoreOverridesByOrder: {},
  }
}

export function parseTileInput(input: string): string[] {
  const compact = input.toLowerCase().replace(/\s+/g, '')
  const out: string[] = []
  let digits = ''

  for (const ch of compact) {
    if (/[0-9]/.test(ch)) {
      digits += ch
      continue
    }
    if (isTileSuit(ch)) {
      for (const rank of digits) {
        if ((rank !== '0' || ch !== 'z') && (ch !== 'z' || Number(rank) <= 7)) out.push(`${rank}${ch}`)
      }
      digits = ''
    } else {
      digits = ''
    }
  }

  return sortTileCodes([...new Set(out)])
}

export function tileOf(code: string): Tile | null {
  const m = code.match(/^([0-9])([mpsz])$/)
  if (!m) return null
  const rank = m[1]
  const suit = m[2] as TileSuit
  if (rank === '0' && suit === 'z') return null
  if (suit === 'z' && Number(rank) > 7) return null
  return { code, rank, suit }
}

export function tileLabel(code: string): string {
  const tile = tileOf(code)
  if (!tile) return code
  if (tile.suit === 'm') return `${kanjiNums[Number(tile.rank)]}万`
  if (tile.suit === 'p') return `${kanjiNums[Number(tile.rank)]}筒`
  if (tile.suit === 's') return `${kanjiNums[Number(tile.rank)]}索`
  return honorLabels[Number(tile.rank)] ?? code
}

export function tileSvgDataUrl(code: string): string {
  const tile = tileOf(code)
  const label = tileLabel(code)
  const color = tile?.suit === 'm' ? '#c8171d' : tile?.suit === 's' ? '#167a3a' : '#101722'
  const sub = tile?.suit === 'm' ? '萬' : tile?.suit === 'p' ? '筒' : tile?.suit === 's' ? '索' : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="132" viewBox="0 0 96 132">
  <rect x="5" y="4" width="86" height="124" rx="9" fill="#f8f3e8"/>
  <rect x="9" y="8" width="78" height="116" rx="7" fill="#fffdf7" stroke="#d8d0c3" stroke-width="2"/>
  <text x="48" y="62" text-anchor="middle" font-family="serif" font-size="42" font-weight="800" fill="${color}">${escapeXml(tile?.rank ?? label)}</text>
  <text x="48" y="98" text-anchor="middle" font-family="serif" font-size="24" font-weight="800" fill="${color}">${escapeXml(tile?.suit === 'z' ? label : sub)}</text>
</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function tileImageSrc(code: string): string {
  return `/tiles/${encodeURIComponent(code)}.png`
}

export function sortTileCodes(codes: string[]): string[] {
  return [...codes].sort((a, b) => tileOrder(a) - tileOrder(b))
}

function tileOrder(code: string): number {
  const tile = tileOf(code)
  if (!tile) return Number.MAX_SAFE_INTEGER
  const suitBase: Record<TileSuit, number> = { s: 0, p: 20, m: 40, z: 60 }
  const rankOrder = tile.suit === 'z'
    ? Number(tile.rank)
    : suitedRankOrder.indexOf(tile.rank)
  return suitBase[tile.suit] + (rankOrder >= 0 ? rankOrder : 99)
}

function isTileSuit(ch: string): ch is TileSuit {
  return ch === 'm' || ch === 'p' || ch === 's' || ch === 'z'
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => {
    if (ch === '&') return '&amp;'
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    if (ch === '"') return '&quot;'
    return '&apos;'
  })
}

const kanjiNums = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const honorLabels = ['', '东', '南', '西', '北', '白', '发', '中']
const suitedRankOrder = ['1', '2', '3', '4', '5', '0', '6', '7', '8', '9']
