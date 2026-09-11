type ExportGame = {
  stage?: string | null
  round?: string | null
  date?: string | null
  time?: string | null
  live_status?: string | null
  seats?: Array<{
    team?: string | null
    player?: string | null
    name?: string | null
    points?: number | null
  }> | null
}

function roundNo(round: string | null | undefined): number {
  const match = String(round ?? '').match(/\d+/)
  return match ? Number(match[0]) : 0
}

export function buildScheduleExport(games: ExportGame[]) {
  return {
    schedule: games.map((game, index) => ({
      id: `schedule-${String(index + 1).padStart(3, '0')}`,
      stage: game.stage ?? '',
      roundNo: roundNo(game.round),
      date: game.date ?? '',
      time: game.time ?? '',
      live: game.live_status ?? '',
      teams: (game.seats ?? []).map((seat) => seat.team ?? ''),
    })),
    result: [],
  }
}

export function buildResultExport(games: ExportGame[]) {
  return {
    schedule: [],
    result: games.map((game, index) => ({
      id: `result-${String(index + 1).padStart(3, '0')}`,
      stage: game.stage ?? '',
      roundNo: roundNo(game.round),
      date: game.date ?? '',
      seats: (game.seats ?? []).map((seat) => ({
        team: seat.team ?? '',
        name: seat.player ?? seat.name ?? '',
        score: Number(seat.points ?? 0),
      })),
    })),
  }
}
