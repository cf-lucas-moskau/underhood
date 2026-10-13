import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { Culprit, Group, GroupMinute, Kind, Minute, Pressure, SeriesPoint } from '../shared/types.js'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const KEEP_MINUTES = DAY
const KEEP_HOURS = 7 * DAY
const KEEP_FILES = 8 * DAY
const MAX_GROUPS = 60
const SPARK_BUCKETS = 40

const PRESSURE_RANK: Record<Pressure, number> = { normal: 0, warn: 1, critical: 2 }
const worse = (a: Pressure, b: Pressure) => (PRESSURE_RANK[a] >= PRESSURE_RANK[b] ? a : b)

export interface SystemSample { cpu: number; mem: number; swap: number; pressure: Pressure }

interface GroupAcc { kind: Kind; cpu: number; mem: number; memN: number; memMax: number; power: number; netIn: number; netOut: number }
interface Acc { ts: number; samples: number; secs: number; cpu: number; mem: number; swap: number; pressure: Pressure; groups: Map<string, GroupAcc> }

const r2 = (n: number) => Math.round(n * 100) / 100

/** Keep the groups worth remembering, rounded so a day of history stays a few MB. */
function trimGroups(groups: GroupMinute[]): GroupMinute[] {
  const keep = groups.filter(g => g.cpu >= 0.1 || g.mem >= 50 * 1024 ** 2 || g.netIn + g.netOut >= 1024 * 1024)
  const byCpu = [...keep].sort((a, b) => b.cpu - a.cpu).slice(0, MAX_GROUPS / 2)
  const byMem = [...keep].sort((a, b) => b.mem - a.mem).slice(0, MAX_GROUPS / 2)
  return [...new Set([...byCpu, ...byMem])].map(g => ({
    ...g, cpu: r2(g.cpu), power: r2(g.power), mem: Math.round(g.mem), memMax: Math.round(g.memMax), netIn: Math.round(g.netIn), netOut: Math.round(g.netOut),
  }))
}

/** Merge buckets into one, weighting averages by span. Absent groups count as idle. */
export function rollup(buckets: Minute[], ts: number): Minute {
  const span = buckets.reduce((s, b) => s + b.span, 0) || 1
  const acc = new Map<string, GroupMinute & { memSpan: number }>()
  let cpu = 0, mem = 0, swap = 0
  let pressure: Pressure = 'normal'
  for (const b of buckets) {
    cpu += b.cpu * b.span
    mem += b.mem * b.span
    swap += b.swap * b.span
    pressure = worse(pressure, b.pressure)
    for (const g of b.groups) {
      let a = acc.get(g.name)
      if (!a) acc.set(g.name, (a = { name: g.name, kind: g.kind, cpu: 0, mem: 0, memMax: 0, power: 0, netIn: 0, netOut: 0, memSpan: 0 }))
      a.cpu += g.cpu * b.span
      a.power += g.power * b.span
      a.mem += g.mem * b.span
      a.memSpan += b.span
      a.memMax = Math.max(a.memMax, g.memMax)
      a.netIn += g.netIn
      a.netOut += g.netOut
    }
  }
  const groups = [...acc.values()].map(({ memSpan, ...g }) => ({ ...g, cpu: g.cpu / span, power: g.power / span, mem: g.mem / (memSpan || 1) }))
  return { ts, span, cpu: cpu / span, mem: mem / span, swap: swap / span, pressure, groups: trimGroups(groups) }
}

const dayFile = (ts: number) => {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.jsonl`
}

export class History {
  private minutes: Minute[] = []
  private hours: Minute[] = []
  private cur: Acc | null = null

  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true })
  }

  load(now: number) {
    const loaded: Minute[] = []
    for (const f of readdirSync(this.dir)) {
      if (!f.endsWith('.jsonl')) continue
      const path = join(this.dir, f)
      if (statSync(path).mtimeMs < now - KEEP_FILES) {
        unlinkSync(path)
        continue
      }
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line) continue
        try {
          const m = JSON.parse(line) as Minute
          if (m.ts >= now - KEEP_HOURS) loaded.push(m)
        } catch { /* torn write, skip */ }
      }
    }
    loaded.sort((a, b) => a.ts - b.ts)
    const cutoff = Math.floor((now - KEEP_MINUTES) / HOUR) * HOUR
    this.minutes = loaded.filter(m => m.ts >= cutoff)
    const byHour = new Map<number, Minute[]>()
    for (const m of loaded) {
      if (m.ts >= cutoff) break
      const h = Math.floor(m.ts / HOUR) * HOUR
      byHour.set(h, [...(byHour.get(h) ?? []), m])
    }
    this.hours = [...byHour].map(([h, ms]) => rollup(ms, h))
  }

  add(ts: number, intervalSec: number, sys: SystemSample, groups: Group[]) {
    const minuteTs = Math.floor(ts / MIN) * MIN
    if (this.cur && this.cur.ts !== minuteTs) this.finalize()
    const c = (this.cur ??= { ts: minuteTs, samples: 0, secs: 0, cpu: 0, mem: 0, swap: 0, pressure: 'normal', groups: new Map() })
    c.samples++
    c.secs += intervalSec
    c.cpu += sys.cpu
    c.mem += sys.mem
    c.swap += sys.swap
    c.pressure = worse(c.pressure, sys.pressure)
    for (const g of groups) {
      let a = c.groups.get(g.name)
      if (!a) c.groups.set(g.name, (a = { kind: g.kind, cpu: 0, mem: 0, memN: 0, memMax: 0, power: 0, netIn: 0, netOut: 0 }))
      a.cpu += g.cpu
      a.power += g.power
      a.mem += g.mem
      a.memN++
      a.memMax = Math.max(a.memMax, g.mem)
      a.netIn += g.netIn * intervalSec
      a.netOut += g.netOut * intervalSec
    }
  }

  private toMinute(c: Acc): Minute {
    const n = c.samples || 1
    const groups = [...c.groups].map(([name, a]) => ({
      name, kind: a.kind, cpu: a.cpu / n, mem: a.mem / (a.memN || 1), memMax: a.memMax, power: a.power / n, netIn: a.netIn, netOut: a.netOut,
    }))
    return { ts: c.ts, span: Math.min(60, c.secs), cpu: r2(c.cpu / n), mem: Math.round(c.mem / n), swap: Math.round(c.swap / n), pressure: c.pressure, groups: trimGroups(groups) }
  }

  flush() {
    this.finalize()
  }

  private finalize() {
    if (!this.cur) return
    const m = this.toMinute(this.cur)
    this.cur = null
    const prev = this.minutes[this.minutes.length - 1]
    this.minutes.push(m)
    try {
      appendFileSync(join(this.dir, dayFile(m.ts)), JSON.stringify(m) + '\n')
    } catch (e) {
      console.error('underhood: could not persist history', e)
    }
    if (prev && Math.floor(prev.ts / HOUR) !== Math.floor(m.ts / HOUR)) this.compact(m.ts)
  }

  /** Move minutes older than 24h (hour aligned) into hourly rollups; drop hours older than 7d. */
  private compact(now: number) {
    const cutoff = Math.floor((now - KEEP_MINUTES) / HOUR) * HOUR
    const old = this.minutes.filter(m => m.ts < cutoff)
    if (old.length) {
      this.minutes = this.minutes.filter(m => m.ts >= cutoff)
      const byHour = new Map<number, Minute[]>()
      for (const m of old) {
        const h = Math.floor(m.ts / HOUR) * HOUR
        byHour.set(h, [...(byHour.get(h) ?? []), m])
      }
      for (const [h, ms] of byHour) this.hours.push(rollup(ms, h))
    }
    this.hours = this.hours.filter(h => h.ts >= now - KEEP_HOURS)
  }

  private buckets(windowMs: number, now: number): Minute[] {
    const from = now - windowMs
    const minutesStart = this.minutes[0]?.ts ?? this.cur?.ts ?? now
    const out = [
      ...this.hours.filter(h => h.ts >= from && h.ts + HOUR <= minutesStart),
      ...this.minutes.filter(m => m.ts >= from),
    ]
    if (this.cur && this.cur.ts >= from) out.push(this.toMinute(this.cur))
    return out
  }

  culprits(windowMs: number, now: number, limit = 150): Culprit[] {
    const buckets = this.buckets(windowMs, now)
    const total = buckets.reduce((s, b) => s + b.span, 0) || 1
    const from = now - windowMs
    const bucketMs = windowMs / SPARK_BUCKETS
    const sparkSpan = new Array<number>(SPARK_BUCKETS).fill(0)
    const idx = (ts: number) => Math.min(SPARK_BUCKETS - 1, Math.max(0, Math.floor((ts - from) / bucketMs)))
    for (const b of buckets) sparkSpan[idx(b.ts)] += b.span

    const acc = new Map<string, Culprit & { memSpan: number }>()
    for (const b of buckets) {
      const i = idx(b.ts)
      for (const g of b.groups) {
        let c = acc.get(g.name)
        if (!c) acc.set(g.name, (c = { name: g.name, kind: g.kind, cpuSeconds: 0, cpuAvg: 0, memAvg: 0, memMax: 0, powerAvg: 0, netBytes: 0, minutes: 0, spark: new Array<number>(SPARK_BUCKETS).fill(0) as (number | null)[], memSpan: 0 }))
        c.cpuSeconds += (g.cpu / 100) * b.span
        c.powerAvg += g.power * b.span
        c.memAvg += g.mem * b.span
        c.memSpan += b.span
        c.memMax = Math.max(c.memMax, g.memMax)
        c.netBytes += g.netIn + g.netOut
        c.minutes += b.span / 60
        c.spark[i] = (c.spark[i] ?? 0) + g.cpu * b.span
      }
    }
    return [...acc.values()]
      .map(({ memSpan, ...c }) => ({
        ...c,
        cpuAvg: (c.cpuSeconds / total) * 100,
        powerAvg: c.powerAvg / total,
        memAvg: c.memAvg / (memSpan || 1),
        spark: c.spark.map((v, i) => (sparkSpan[i] ? (v ?? 0) / sparkSpan[i] : null)),
      }))
      .sort((a, b) => b.cpuSeconds - a.cpuSeconds || b.memAvg - a.memAvg)
      .slice(0, limit)
  }

  series(name: string, windowMs: number, now: number): SeriesPoint[] {
    return this.buckets(windowMs, now).map(b => {
      const g = b.groups.find(x => x.name === name)
      return { ts: b.ts, cpu: g?.cpu ?? 0, mem: g?.mem ?? 0, power: g?.power ?? 0 }
    })
  }

  timeline(windowMs: number, now: number) {
    return this.buckets(windowMs, now).map(b => ({ ts: b.ts, span: b.span, cpu: b.cpu, mem: b.mem, swap: b.swap, pressure: b.pressure }))
  }
}
