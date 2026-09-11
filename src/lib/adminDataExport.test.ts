import { describe, expect, it } from 'vitest'
import { buildResultExport, buildScheduleExport } from './adminDataExport'

describe('后台批量导出', () => {
  it('按勾选顺序生成赛程 JSON', () => {
    expect(buildScheduleExport([{
      stage: '常规赛',
      round: '第2半庄',
      date: '2026-09-10',
      time: '16:00',
      live_status: '非直播',
      seats: [{ team: '凤凰' }, { team: '海盗' }, { team: '火山' }, { team: '赤坂' }],
    }])).toEqual({
      schedule: [{
        id: 'schedule-001',
        stage: '常规赛',
        roundNo: 2,
        date: '2026-09-10',
        time: '16:00',
        live: '非直播',
        teams: ['凤凰', '海盗', '火山', '赤坂'],
      }],
      result: [],
    })
  })

  it('生成赛果 JSON 并保持座次顺序', () => {
    expect(buildResultExport([{
      stage: '常规赛',
      round: '第1半庄',
      date: '2026-09-10',
      seats: [
        { team: '火山', player: '选手甲', points: 42000 },
        { team: '赤坂', player: '选手乙', points: 28000 },
      ],
    }])).toEqual({
      schedule: [],
      result: [{
        id: 'result-001',
        stage: '常规赛',
        roundNo: 1,
        date: '2026-09-10',
        seats: [
          { team: '火山', name: '选手甲', score: 42000 },
          { team: '赤坂', name: '选手乙', score: 28000 },
        ],
      }],
    })
  })
})
