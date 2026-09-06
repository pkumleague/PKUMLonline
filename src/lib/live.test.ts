import { describe, expect, it } from 'vitest'
import { parseTileInput, tileLabel, tileOf } from './live'

describe('parseTileInput', () => {
  it('parses repeated suit notation', () => {
    expect(parseTileInput('6m3m')).toEqual(['3m', '6m'])
  })

  it('parses compact same-suit notation', () => {
    expect(parseTileInput('63m')).toEqual(['3m', '6m'])
    expect(parseTileInput('36m')).toEqual(['3m', '6m'])
  })

  it('parses multiple suits and removes duplicates', () => {
    expect(parseTileInput('3m 7p 36m')).toEqual(['7p', '3m', '6m'])
  })

  it('drops invalid honor ranks', () => {
    expect(parseTileInput('178z')).toEqual(['1z', '7z'])
  })

  it('supports red fives for suited tiles', () => {
    expect(parseTileInput('0m0p0s0z')).toEqual(['0s', '0p', '0m'])
  })

  it('sorts display order by s, p, m, z with red five after five', () => {
    expect(parseTileInput('7z9m0m5m1p0s6s2z3p1s')).toEqual(['1s', '0s', '6s', '1p', '3p', '5m', '0m', '9m', '2z', '7z'])
  })
})

describe('tile display helpers', () => {
  it('labels numbered and honor tiles', () => {
    expect(tileLabel('3m')).toBe('三万')
    expect(tileLabel('6p')).toBe('六筒')
    expect(tileLabel('7z')).toBe('中')
  })

  it('validates tile codes', () => {
    expect(tileOf('9s')).toEqual({ code: '9s', rank: '9', suit: 's' })
    expect(tileOf('8z')).toBeNull()
  })
})
