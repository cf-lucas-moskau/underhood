import { describe, expect, it } from 'vitest'
import { summarize, windowStats } from './smooth'
import type { RecentSample } from '../shared/types'

const s = (ts: number, g: RecentSample['g'], p: RecentSample['p'] = {}): RecentSample => ({ ts, g, p })

describe('summarize', () => {
  const recent = [
    s(0, { Chrome: [10, 10, 0] }),
    s(2000, { Chrome: [10, 12, 100] }),
    s(4000, { Chrome: [10, 10, 0], Burst: [300, 300, 0] }),
    s(6000, { Chrome: [10, 10, 0] }),
  ]

  it('averages over the window, counting absent samples as idle', () => {
    const m = summarize(recent, 'g', 30_000)
    expect(m.get('Chrome')!.avg).toBe(10)
    expect(m.get('Burst')!.avg).toBe(75)
    expect(m.get('Burst')!.now).toBe(0)
    expect(m.get('Chrome')!.net).toBe(25)
  })

  it('keeps the peak and a per-sample spark so spikes stay visible', () => {
    const b = summarize(recent, 'g', 30_000).get('Burst')!
    expect(b.peak).toBe(300)
    expect(b.spark).toEqual([0, 0, 300, 0])
    expect(b.spiking).toBe(true)
    expect(summarize(recent, 'g', 30_000).get('Chrome')!.spiking).toBe(false)
  })

  it('only looks at samples inside the window', () => {
    const m = summarize(recent, 'g', 3000)
    expect(m.get('Chrome')!.avg).toBe(10)
    expect(m.has('Burst')).toBe(true)
    expect(m.get('Burst')!.avg).toBe(150)
  })

  it('a window of one sample is the raw value', () => {
    expect(summarize(recent, 'g', 0).get('Chrome')!.avg).toBe(10)
    expect(summarize(recent, 'g', 0).has('Burst')).toBe(false)
  })

  it('ignores small wobbles', () => {
    const wobble = [s(0, { W: [10, 0, 0] }), s(2000, { W: [42, 0, 0] }), s(4000, { W: [8, 0, 0] })]
    expect(summarize(wobble, 'g', 30_000).get('W')!.spiking).toBe(false)
  })

  it('does not flag steady heavy load as a spike', () => {
    const steady = [s(0, { X: [400, 0, 0] }), s(2000, { X: [420, 0, 0] }), s(4000, { X: [390, 0, 0] })]
    expect(summarize(steady, 'g', 30_000).get('X')!.spiking).toBe(false)
  })
})

describe('windowStats', () => {
  it('returns average, peak and latest of a series inside the window', () => {
    const pts = [{ ts: 0, v: 50 }, { ts: 2000, v: 10 }, { ts: 4000, v: 30 }]
    expect(windowStats(pts, p => p.v, 30_000)).toEqual({ avg: 30, peak: 50, now: 30 })
    expect(windowStats(pts, p => p.v, 4000)).toEqual({ avg: 20, peak: 30, now: 30 })
    expect(windowStats([], (p: { v: number }) => p.v, 1000)).toEqual({ avg: 0, peak: 0, now: 0 })
  })
})
