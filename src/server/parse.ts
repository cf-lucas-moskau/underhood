// Pure parsers for the macOS tools underhood shells out to. No I/O here.

const UNITS: Record<string, number> = { B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }

export function parseBytes(s: string): number {
  const m = /^([\d.]+)([BKMGT])?[+-]?$/.exec(s.trim())
  if (!m) return 0
  return parseFloat(m[1]) * (m[2] ? UNITS[m[2]] : 1)
}

export interface TopRow { pid: number; cpu: number; mem: number; power: number; threads: number }
export interface TopSample {
  cpuUser: number
  cpuSys: number
  cpuIdle: number
  load: [number, number, number]
  memUsed: number
  memWired: number
  memCompressed: number
  procCount: number
  threadCount: number
  rows: Map<number, TopRow>
}

/** `top -l N` prints one block per sample, each starting with "Processes:". */
export function splitTopSamples(text: string): string[] {
  return text.split(/^(?=Processes:)/m).filter(s => s.startsWith('Processes:'))
}

export function parseTopSample(text: string): TopSample {
  const s: TopSample = {
    cpuUser: 0, cpuSys: 0, cpuIdle: 100, load: [0, 0, 0],
    memUsed: 0, memWired: 0, memCompressed: 0, procCount: 0, threadCount: 0, rows: new Map(),
  }
  const lines = text.split('\n')
  let cols: string[] | null = null
  for (const line of lines) {
    if (cols) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < cols.length) continue
      const get = (c: string) => parts[cols!.indexOf(c)]
      const pid = parseInt(get('PID'), 10)
      if (Number.isNaN(pid)) continue
      s.rows.set(pid, {
        pid,
        cpu: parseFloat(get('%CPU')) || 0,
        mem: parseBytes(get('MEM') ?? '0'),
        power: parseFloat(get('POWER') ?? '0') || 0,
        threads: parseInt(get('#TH') ?? '0', 10) || 0,
      })
      continue
    }
    let m: RegExpExecArray | null
    if ((m = /^Processes: (\d+) total.*?(\d+) threads/.exec(line))) {
      s.procCount = +m[1]
      s.threadCount = +m[2]
    } else if ((m = /^Load Avg: ([\d.]+), ([\d.]+), ([\d.]+)/.exec(line))) {
      s.load = [+m[1], +m[2], +m[3]]
    } else if ((m = /^CPU usage: ([\d.]+)% user, ([\d.]+)% sys, ([\d.]+)% idle/.exec(line))) {
      s.cpuUser = +m[1]
      s.cpuSys = +m[2]
      s.cpuIdle = +m[3]
    } else if ((m = /^PhysMem: (\S+) used \((\S+) wired, (\S+) compressor\)/.exec(line))) {
      s.memUsed = parseBytes(m[1])
      s.memWired = parseBytes(m[2])
      s.memCompressed = parseBytes(m[3])
    } else if (line.startsWith('PID ')) {
      cols = line.trim().split(/\s+/)
    }
  }
  return s
}

export interface PsRow { pid: number; ppid: number; user: string; cpuTime: number; path: string }

function parseCpuTime(t: string): number {
  // [[dd-]hh:]mm:ss.cc
  let days = 0
  const dash = t.indexOf('-')
  if (dash >= 0) {
    days = parseInt(t.slice(0, dash), 10)
    t = t.slice(dash + 1)
  }
  const parts = t.split(':').map(Number)
  let secs = 0
  for (const p of parts) secs = secs * 60 + p
  return days * 86400 + secs
}

/** `ps -axww -o pid=,ppid=,user=,time=,comm=` */
export function parsePs(text: string): Map<number, PsRow> {
  const rows = new Map<number, PsRow>()
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*?)\s*$/.exec(line)
    if (!m) continue
    const pid = +m[1]
    rows.set(pid, { pid, ppid: +m[2], user: m[3], cpuTime: parseCpuTime(m[4]), path: m[5] })
  }
  return rows
}

/** `ps -axww -o pid=,args=` */
export function parsePsArgs(text: string): Map<number, string> {
  const rows = new Map<number, string>()
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s(.*?)\s*$/.exec(line)
    if (m) rows.set(+m[1], m[2])
  }
  return rows
}

export type NetSample = Map<number, { in: number; out: number }>

/** `nettop -P -x -J bytes_in,bytes_out` (one block per sample, each with a header line) */
export function parseNettop(text: string): NetSample[] {
  const samples: NetSample[] = []
  for (const line of text.split('\n')) {
    if (line.startsWith(',bytes_in')) {
      samples.push(new Map())
      continue
    }
    const m = /^.*\.(\d+),(\d+),(\d+),?$/.exec(line)
    if (!m || !samples.length) continue
    samples[samples.length - 1].set(+m[1], { in: +m[2], out: +m[3] })
  }
  return samples
}

/** `ioreg -c IOBlockStorageDriver -r -w0 -d 1`: cumulative bytes across all drives */
export function parseDiskStats(text: string): { read: number; write: number } {
  let read = 0
  let write = 0
  for (const m of text.matchAll(/"Bytes \((Read|Write)\)"=(\d+)/g)) {
    if (m[1] === 'Read') read += +m[2]
    else write += +m[2]
  }
  return { read, write }
}

/** `ioreg -r -d 1 -w 0 -c IOAccelerator` */
export function parseGpu(text: string): number | null {
  const m = /"Device Utilization %"=(\d+)/.exec(text)
  return m ? +m[1] : null
}

/** `pmset -g batt` */
export function parseBattery(text: string): { percent: number; source: string; charging: boolean } | null {
  const src = /Now drawing from '([^']+)'/.exec(text)
  const b = /(\d+)%; ([^;]+);/.exec(text)
  if (!b) return null
  return { percent: +b[1], source: src?.[1] ?? '', charging: b[2].trim() === 'charging' || b[2].includes('finishing') }
}

/** `df -k /` */
export function parseDf(text: string): { total: number; free: number } {
  const line = text.trim().split('\n')[1] ?? ''
  const parts = line.split(/\s+/)
  return { total: (+parts[1] || 0) * 1024, free: (+parts[3] || 0) * 1024 }
}

/** `launchctl list` */
export function parseLaunchctlList(text: string): Map<string, number | null> {
  const m = new Map<string, number | null>()
  for (const line of text.split('\n').slice(1)) {
    const [pid, , label] = line.split('\t')
    if (label) m.set(label, pid === '-' ? null : +pid)
  }
  return m
}

/** `launchctl print-disabled <domain>` */
export function parseDisabled(text: string): Map<string, boolean> {
  const m = new Map<string, boolean>()
  for (const x of text.matchAll(/"([^"]+)" => (enabled|disabled|true|false)/g)) m.set(x[1], x[2] === 'disabled' || x[2] === 'true')
  return m
}

/** `sysctl -n vm.swapusage` (decimal separator follows the locale) */
export function parseSwap(text: string): { total: number; used: number } {
  const num = (k: string) => {
    const m = new RegExp(`${k} = ([\\d.,]+)([KMG])`).exec(text)
    return m ? parseFloat(m[1].replace(',', '.')) * UNITS[m[2]] : 0
  }
  return { total: num('total'), used: num('used') }
}

/** Per-pid byte rates from two cumulative nettop readings. New pids and counter resets yield 0. */
export function netRates(prev: NetSample, cur: NetSample, seconds: number): NetSample {
  const out: NetSample = new Map()
  for (const [pid, c] of cur) {
    const p = prev.get(pid)
    if (!p) continue
    out.set(pid, { in: Math.max(0, c.in - p.in) / seconds, out: Math.max(0, c.out - p.out) / seconds })
  }
  return out
}

/** `vm_stat`, reduced the way Activity Monitor does: used = app + wired + compressed. */
export function parseVmStat(text: string): { app: number; wired: number; compressed: number; cached: number; used: number } {
  const page = +(/page size of (\d+) bytes/.exec(text)?.[1] ?? 16384)
  const get = (label: string) => +(new RegExp(`${label}:\\s+(\\d+)`).exec(text)?.[1] ?? 0) * page
  const purgeable = get('Pages purgeable')
  const app = Math.max(0, get('Anonymous pages') - purgeable)
  const wired = get('Pages wired down')
  const compressed = get('Pages occupied by compressor')
  return { app, wired, compressed, cached: get('File-backed pages') + purgeable, used: app + wired + compressed }
}

/** `netstat -ibn`: cumulative bytes over physical (en*) interfaces. Tunnels would double count. */
export function parseNetstat(text: string): { in: number; out: number } {
  let i = 0
  let o = 0
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (!/^en\d+$/.test(parts[0]) || !parts[2]?.startsWith('<Link#')) continue
    const n = parts.length
    i += +parts[n - 5] || 0
    o += +parts[n - 2] || 0
  }
  return { in: i, out: o }
}
