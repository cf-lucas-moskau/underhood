import type { RecentSample } from '../shared/types'

export interface Activity {
  /** average CPU over the window, % of one core */
  avg: number
  peak: number
  /** latest raw sample */
  now: number
  power: number
  /** average bytes/s */
  net: number
  /** raw CPU per sample, oldest first */
  spark: number[]
  /** a short burst well above the average happened inside the window */
  spiking: boolean
}

/** Half a core: below that a burst isn't worth shouting about. */
const SPIKE_MIN = 50

export const isSpike = (avg: number, peak: number, min = SPIKE_MIN) => peak >= min && peak >= avg * 2.5

function inWindow<T extends { ts: number }>(points: T[], windowMs: number): T[] {
  if (!points.length) return []
  const end = points[points.length - 1].ts
  // Always keep the latest sample, so a zero window means "raw".
  return points.filter((p, i) => i === points.length - 1 || p.ts > end - windowMs)
}

/** Smooth per-group ('g') or per-process ('p') activity over the trailing window. */
export function summarize(recent: RecentSample[], kind: 'g' | 'p', windowMs: number): Map<string, Activity> {
  const samples = inWindow(recent, windowMs)
  const n = samples.length
  const out = new Map<string, Activity>()
  samples.forEach((sample, i) => {
    for (const [key, [cpu, power, net]] of Object.entries(sample[kind])) {
      let a = out.get(key)
      if (!a) out.set(key, (a = { avg: 0, peak: 0, now: 0, power: 0, net: 0, spark: new Array(n).fill(0), spiking: false }))
      a.avg += cpu / n
      a.power += power / n
      a.net += net / n
      a.peak = Math.max(a.peak, cpu)
      a.spark[i] = cpu
      if (i === n - 1) a.now = cpu
    }
  })
  for (const a of out.values()) a.spiking = isSpike(a.avg, a.peak)
  return out
}

export function windowStats<T extends { ts: number }>(points: T[], get: (p: T) => number, windowMs: number) {
  const pts = inWindow(points, windowMs)
  if (!pts.length) return { avg: 0, peak: 0, now: 0 }
  const vals = pts.map(get)
  return { avg: vals.reduce((s, v) => s + v, 0) / vals.length, peak: Math.max(...vals), now: vals[vals.length - 1] }
}
