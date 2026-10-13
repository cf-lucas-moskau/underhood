import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { hostname, totalmem, uptime, cpus } from 'node:os'
import { promisify } from 'node:util'
import type { Group, Kind, Pressure, Proc, RecentSample, Snapshot, SystemPoint, SystemStats } from '../shared/types.js'
import { compactRecent } from '../shared/recent.js'
import { attribute, classify, displayName, type ProcInfo } from './group.js'
import {
  parseBattery, parseDf, parseDiskStats, parseGpu, parseNettop, parseNetstat, parseVmStat, netRates, parsePs, parsePsArgs, parseSwap,
  parseTopSample, splitTopSamples, type NetSample, type TopSample,
} from './parse.js'

const run = promisify(execFile)
const sh = async (cmd: string, args: string[]) => (await run(cmd, args, { maxBuffer: 64 * 1024 * 1024 })).stdout

const KIND_PRIORITY: Kind[] = ['app', 'thirdparty', 'cli', 'system']
const PRESSURE: Record<string, Pressure> = { '1': 'normal', '2': 'warn', '4': 'critical' }
const LIVE_POINTS = 450
const RECENT_SAMPLES = 150

/**
 * Keeps a long-running process alive and calls `onBlock` with everything it printed
 * once output goes quiet. top and nettop write each sample in one burst, so a short
 * quiet period marks the end of a sample.
 */
function stream(cmd: string, args: string[], onBlock: (text: string) => void): () => void {
  let child: ChildProcess | null = null
  let buf = ''
  let timer: NodeJS.Timeout | null = null
  let stopped = false
  const start = () => {
    child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] })
    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', (d: string) => {
      buf += d
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const text = buf
        buf = ''
        onBlock(text)
      }, 250)
    })
    child.on('exit', () => {
      if (!stopped) setTimeout(start, 2000)
    })
  }
  start()
  return () => {
    stopped = true
    child?.kill()
  }
}

export class Collector extends EventEmitter {
  latest: Snapshot | null = null
  live: SystemPoint[] = []
  recent: RecentSample[] = []
  private net: NetSample = new Map()
  private topSeen = 0
  private disk: { read: number; write: number; ts: number } | null = null
  private ifaces: { in: number; out: number; ts: number } | null = null
  private slow = { diskTotal: 0, diskFree: 0, battery: null as SystemStats['battery'], swapTotal: 0, swapUsed: 0, pressure: 'normal' as Pressure, slowAt: 0 }
  private meta = { model: '', osVersion: '', host: '' }
  private stops: (() => void)[] = []
  private busy = false

  constructor(private interval: number, private allowKill: boolean) {
    super()
  }

  async start() {
    const [model, cpu, os, name] = await Promise.all([
      sh('sysctl', ['-n', 'hw.model']).catch(() => ''),
      sh('sysctl', ['-n', 'machdep.cpu.brand_string']).catch(() => ''),
      sh('sw_vers', ['-productVersion']).catch(() => ''),
      sh('scutil', ['--get', 'ComputerName']).catch(() => ''),
    ])
    this.meta = { model: `${cpu.trim()} (${model.trim()})`, osVersion: os.trim(), host: name.trim() || hostname().replace(/\.local$/, '') }
    const s = String(this.interval)
    this.stops.push(stream('top', ['-l', '0', '-s', s, '-stats', 'pid,cpu,mem,power,threads'], text => {
      for (const block of splitTopSamples(text)) {
        // The first sample has no CPU deltas yet.
        if (this.topSeen++ === 0) continue
        void this.onTop(parseTopSample(block))
      }
    }))
    this.pollNet()
  }

  /**
   * `nettop -L 0` spins a full core, so take a one-shot cumulative reading every
   * few seconds instead and diff it against the previous one.
   */
  private pollNet() {
    let prev: { at: number; sample: NetSample } | null = null
    let stopped = false
    const tick = async () => {
      if (stopped) return
      try {
        const sample = parseNettop(await sh('nettop', ['-P', '-L', '1', '-x', '-J', 'bytes_in,bytes_out']))[0]
        const at = Date.now()
        if (sample && prev) this.net = netRates(prev.sample, sample, (at - prev.at) / 1000)
        if (sample) prev = { at, sample }
      } catch { /* nettop unavailable, leave network at zero */ }
      setTimeout(tick, Math.max(this.interval, 5) * 1000)
    }
    void tick()
    this.stops.push(() => { stopped = true })
  }

  stop() {
    for (const s of this.stops) s()
  }

  private async refreshSlow(now: number) {
    if (now - this.slow.slowAt < 15_000) return
    this.slow.slowAt = now
    const [df, batt, swap, pressure] = await Promise.all([
      sh('df', ['-k', '/System/Volumes/Data']).catch(() => sh('df', ['-k', '/'])),
      sh('pmset', ['-g', 'batt']).catch(() => ''),
      sh('sysctl', ['-n', 'vm.swapusage']).catch(() => ''),
      sh('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level']).catch(() => '1'),
    ])
    const d = parseDf(df)
    const sw = parseSwap(swap)
    Object.assign(this.slow, {
      diskTotal: d.total, diskFree: d.free, battery: parseBattery(batt),
      swapTotal: sw.total, swapUsed: sw.used, pressure: PRESSURE[pressure.trim()] ?? 'normal',
    })
  }

  private async onTop(top: TopSample) {
    if (this.busy) return
    this.busy = true
    try {
      const now = Date.now()
      const [psOut, argsOut, ioDisk, ioGpu, vmOut, netOut_] = await Promise.all([
        sh('ps', ['-axww', '-o', 'pid=,ppid=,user=,time=,comm=']),
        sh('ps', ['-axww', '-o', 'pid=,args=']),
        sh('ioreg', ['-c', 'IOBlockStorageDriver', '-r', '-w0', '-d', '1']).catch(() => ''),
        sh('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator']).catch(() => ''),
        sh('vm_stat', []).catch(() => ''),
        sh('netstat', ['-ibn']).catch(() => ''),
        this.refreshSlow(now),
      ])
      const vm = parseVmStat(vmOut)
      const ifNow = { ...parseNetstat(netOut_), ts: now }
      let sysNetIn = 0
      let sysNetOut = 0
      if (this.ifaces) {
        const dt = (now - this.ifaces.ts) / 1000
        sysNetIn = Math.max(0, (ifNow.in - this.ifaces.in) / dt)
        sysNetOut = Math.max(0, (ifNow.out - this.ifaces.out) / dt)
      }
      this.ifaces = ifNow
      const ps = parsePs(psOut)
      const args = parsePsArgs(argsOut)

      const diskNow = { ...parseDiskStats(ioDisk), ts: now }
      let diskRead = 0
      let diskWrite = 0
      if (this.disk) {
        const dt = (now - this.disk.ts) / 1000
        diskRead = Math.max(0, (diskNow.read - this.disk.read) / dt)
        diskWrite = Math.max(0, (diskNow.write - this.disk.write) / dt)
      }
      this.disk = diskNow

      const infos = new Map<number, ProcInfo>()
      for (const r of ps.values()) infos.set(r.pid, { pid: r.pid, ppid: r.ppid, path: r.path, user: r.user, args: (args.get(r.pid) ?? r.path).slice(0, 400) })

      const procs: Proc[] = []
      const groups = new Map<string, Group>()
      for (const info of infos.values()) {
        const t = top.rows.get(info.pid)
        const n = this.net.get(info.pid)
        const proc: Proc = {
          pid: info.pid,
          ppid: info.ppid,
          user: info.user,
          name: displayName(info.path, info.args),
          path: info.path,
          args: info.args,
          cpu: t?.cpu ?? 0,
          mem: t?.mem ?? 0,
          power: t?.power ?? 0,
          threads: t?.threads ?? 0,
          netIn: n?.in ?? 0,
          netOut: n?.out ?? 0,
          group: attribute(info.pid, infos),
          kind: classify(info.path, info.user),
        }
        procs.push(proc)
        let g = groups.get(proc.group)
        if (!g) groups.set(proc.group, (g = { name: proc.group, kind: proc.kind, cpu: 0, mem: 0, power: 0, netIn: 0, netOut: 0, pids: [] }))
        if (KIND_PRIORITY.indexOf(proc.kind) < KIND_PRIORITY.indexOf(g.kind)) g.kind = proc.kind
        g.cpu += proc.cpu
        g.mem += proc.mem
        g.power += proc.power
        g.netIn += proc.netIn
        g.netOut += proc.netOut
        g.pids.push(proc.pid)
      }

      const cores = cpus().length
      const system: SystemStats = {
        cpuUser: top.cpuUser,
        cpuSys: top.cpuSys,
        cpuIdle: top.cpuIdle,
        cores,
        load: top.load,
        memTotal: totalmem(),
        memUsed: vm.used || top.memUsed,
        memApp: vm.app,
        memWired: vm.wired || top.memWired,
        memCompressed: vm.compressed || top.memCompressed,
        memCached: vm.cached,
        swapUsed: this.slow.swapUsed,
        swapTotal: this.slow.swapTotal,
        pressure: this.slow.pressure,
        gpu: parseGpu(ioGpu),
        netIn: sysNetIn,
        netOut: sysNetOut,
        diskRead,
        diskWrite,
        diskTotal: this.slow.diskTotal,
        diskFree: this.slow.diskFree,
        battery: this.slow.battery,
        procCount: top.procCount,
        threadCount: top.threadCount,
      }

      const snap: Snapshot = {
        ts: now,
        host: this.meta.host,
        model: this.meta.model,
        osVersion: this.meta.osVersion,
        uptime: uptime(),
        interval: this.interval,
        allowKill: this.allowKill,
        system,
        procs: procs.sort((a, b) => b.cpu - a.cpu),
        groups: [...groups.values()].sort((a, b) => b.cpu - a.cpu),
      }
      this.latest = snap
      this.live.push({
        ts: now, cpu: system.cpuUser + system.cpuSys, cpuSys: system.cpuSys,
        mem: system.memUsed, swap: system.swapUsed, gpu: system.gpu,
        netIn: sysNetIn, netOut: sysNetOut, diskRead, diskWrite,
      })
      if (this.live.length > LIVE_POINTS) this.live.splice(0, this.live.length - LIVE_POINTS)
      this.recent.push(compactRecent(snap))
      if (this.recent.length > RECENT_SAMPLES) this.recent.splice(0, this.recent.length - RECENT_SAMPLES)
      this.emit('snapshot', snap)
    } catch (e) {
      console.error('underhood: sample failed', e)
    } finally {
      this.busy = false
    }
  }
}
