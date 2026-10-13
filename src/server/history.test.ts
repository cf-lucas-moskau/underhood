import { describe, expect, it, beforeEach } from 'vitest'
import { mkdtempSync, readdirSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { History, rollup } from './history.js'
import type { Group, Minute } from '../shared/types.js'

const MIN = 60_000
const g = (name: string, cpu: number, mem: number, extra: Partial<Group> = {}): Group =>
  ({ name, kind: 'app', cpu, mem, power: cpu, netIn: 0, netOut: 0, pids: [1], ...extra })

function feed(h: History, start: number, minutes: number, groups: Group[], interval = 2) {
  for (let t = start; t < start + minutes * MIN; t += interval * 1000) {
    h.add(t, interval, { cpu: 10, mem: 1000, swap: 0, pressure: 'normal' }, groups)
  }
}

describe('History', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'uh-')) })

  it('aggregates samples into minutes and ranks culprits by cpu seconds', () => {
    const h = new History(dir)
    const t0 = Date.UTC(2026, 0, 1, 10, 0)
    feed(h, t0, 3, [g('Chrome', 50, 500), g('Slack', 10, 900)])
    const c = h.culprits(60 * MIN, t0 + 3 * MIN)
    expect(c.map(x => x.name)).toEqual(['Chrome', 'Slack'])
    expect(c[0].cpuSeconds).toBeCloseTo(0.5 * 180, 0)
    expect(c[0].cpuAvg).toBeCloseTo(50, 0)
    expect(c[1].memAvg).toBe(900)
  })

  it('counts a group absent for part of the window as idle, not averaged away', () => {
    const h = new History(dir)
    const t0 = Date.UTC(2026, 0, 1, 10, 0)
    feed(h, t0, 1, [g('Spiky', 100, 10)])
    feed(h, t0 + MIN, 1, [])
    const c = h.culprits(60 * MIN, t0 + 2 * MIN)
    expect(c[0].cpuSeconds).toBeCloseTo(60, 0)
    expect(c[0].cpuAvg).toBeCloseTo(50, 0)
  })

  it('includes the in-progress minute', () => {
    const h = new History(dir)
    const t0 = Date.UTC(2026, 0, 1, 10, 0)
    feed(h, t0, 0.5, [g('Now', 200, 10)])
    expect(h.culprits(15 * MIN, t0 + 30_000)[0]?.name).toBe('Now')
  })

  it('persists minutes and reloads them', () => {
    const t0 = Date.now() - 10 * MIN
    const h = new History(dir)
    feed(h, t0, 3, [g('Docker', 30, 2e9)])
    const again = new History(dir)
    again.load(Date.now())
    expect(again.culprits(60 * MIN, Date.now())[0].name).toBe('Docker')
    expect(readdirSync(dir).some(f => f.endsWith('.jsonl'))).toBe(true)
  })

  it('prunes day files older than retention', () => {
    const old = join(dir, '2020-01-01.jsonl')
    writeFileSync(old, '')
    utimesSync(old, new Date(2020, 0, 1), new Date(2020, 0, 1))
    new History(dir).load(Date.now())
    expect(readdirSync(dir)).not.toContain('2020-01-01.jsonl')
  })

  it('serves a per-group series', () => {
    const h = new History(dir)
    const t0 = Date.UTC(2026, 0, 1, 10, 0)
    feed(h, t0, 3, [g('A', 20, 5)])
    const s = h.series('A', 60 * MIN, t0 + 3 * MIN)
    expect(s.length).toBeGreaterThanOrEqual(3)
    expect(s[0].cpu).toBeCloseTo(20, 0)
  })
})

describe('rollup', () => {
  it('weights averages by span', () => {
    const m = (ts: number, cpu: number): Minute => ({ ts, span: 60, cpu, mem: 0, swap: 0, pressure: 'normal', groups: [{ name: 'X', kind: 'cli', cpu, mem: 10, memMax: 10, power: 0, netIn: 1, netOut: 1 }] })
    const r = rollup([m(0, 10), m(MIN, 30)], 0)
    expect(r.span).toBe(120)
    expect(r.cpu).toBe(20)
    expect(r.groups[0].cpu).toBe(20)
    expect(r.groups[0].netIn).toBe(2)
  })
})
