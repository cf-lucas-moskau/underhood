export type Pressure = 'normal' | 'warn' | 'critical'
export type Kind = 'app' | 'cli' | 'system' | 'thirdparty'

export interface Proc {
  pid: number
  ppid: number
  user: string
  name: string
  path: string
  args: string
  /** % of one core, Activity Monitor semantics (can exceed 100) */
  cpu: number
  /** physical footprint in bytes */
  mem: number
  /** energy impact, Activity Monitor semantics */
  power: number
  threads: number
  /** bytes/s over the last interval */
  netIn: number
  netOut: number
  group: string
  kind: Kind
}

export interface Group {
  name: string
  kind: Kind
  cpu: number
  mem: number
  power: number
  netIn: number
  netOut: number
  pids: number[]
}

export interface SeriesPoint { ts: number; cpu: number; mem: number; power: number }

export interface SystemStats {
  cpuUser: number
  cpuSys: number
  cpuIdle: number
  cores: number
  load: [number, number, number]
  memTotal: number
  /** app + wired + compressed, like Activity Monitor's "Memory Used" */
  memUsed: number
  memApp: number
  memWired: number
  memCompressed: number
  /** file cache + purgeable: reclaimable, not pressure */
  memCached: number
  swapUsed: number
  swapTotal: number
  pressure: Pressure
  gpu: number | null
  netIn: number
  netOut: number
  diskRead: number
  diskWrite: number
  diskTotal: number
  diskFree: number
  battery: { percent: number; source: string; charging: boolean } | null
  procCount: number
  threadCount: number
}

export interface Snapshot {
  ts: number
  host: string
  model: string
  osVersion: string
  uptime: number
  interval: number
  allowKill: boolean
  system: SystemStats
  procs: Proc[]
  groups: Group[]
}

/** One point of the short-term, full-resolution system series */
export interface SystemPoint {
  ts: number
  cpu: number
  cpuSys: number
  mem: number
  swap: number
  gpu: number | null
  netIn: number
  netOut: number
  diskRead: number
  diskWrite: number
}

/** Per-minute aggregate of one group, persisted to disk */
export interface GroupMinute {
  name: string
  kind: Kind
  cpu: number
  mem: number
  memMax: number
  power: number
  netIn: number
  netOut: number
}

/** Aggregate bucket: a minute (span 60) or an hourly rollup (span 3600). Averages, except net = total bytes. */
export interface Minute {
  ts: number
  span: number
  cpu: number
  mem: number
  swap: number
  pressure: Pressure
  groups: GroupMinute[]
}

export interface Culprit {
  name: string
  kind: Kind
  /** CPU seconds burned in the window */
  cpuSeconds: number
  /** average % of one core while sampled */
  cpuAvg: number
  memAvg: number
  memMax: number
  powerAvg: number
  netBytes: number
  minutes: number
  /** cpu per window bucket for a sparkline; null where nothing was sampled (machine off/asleep) */
  spark: (number | null)[]
}

export interface StartupItem {
  label: string
  scope: 'user' | 'global-agent' | 'global-daemon'
  plist: string
  program: string
  runAtLoad: boolean
  keepAlive: boolean
  disabled: boolean
  running: boolean
  pids: number[]
  cpu: number
  mem: number
  vendor: string
  group: string | null
}

/**
 * Compact per-sample activity kept for the last few minutes so clients can
 * smooth values and spot spikes. Entries are [cpu, power, net bytes/s];
 * anything missing was idle in that sample.
 */
export interface RecentSample {
  ts: number
  g: Record<string, [number, number, number]>
  p: Record<number, [number, number, number]>
}
