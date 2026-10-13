import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseBytes, parseTopSample, splitTopSamples, parsePs, parsePsArgs, parseNettop, parseDiskStats, parseGpu, parseBattery, parseDf, parseLaunchctlList } from './parse.js'

const topText = readFileSync(new URL('../../test/fixtures/top-sample.txt', import.meta.url), 'utf8')

describe('parseBytes', () => {
  it('handles top suffixes and trend markers', () => {
    expect(parseBytes('3088K')).toBe(3088 * 1024)
    expect(parseBytes('38M+')).toBe(38 * 1024 ** 2)
    expect(parseBytes('1.5G-')).toBe(1.5 * 1024 ** 3)
    expect(parseBytes('512B')).toBe(512)
    expect(parseBytes('0')).toBe(0)
  })
})

describe('top', () => {
  const samples = splitTopSamples(topText)
  it('splits logging output into samples', () => {
    expect(samples).toHaveLength(2)
  })
  it('parses header and rows', () => {
    const s = parseTopSample(samples[1])
    expect(s.cpuUser).toBeCloseTo(9.2)
    expect(s.cpuSys).toBeCloseTo(5.89)
    expect(s.cpuIdle).toBeCloseTo(84.89)
    expect(s.load).toEqual([1.23, 1.46, 1.81])
    expect(s.memUsed).toBe(31 * 1024 ** 3)
    expect(s.memWired).toBe(3982 * 1024 ** 2)
    expect(s.memCompressed).toBe(6364 * 1024 ** 2)
    expect(s.procCount).toBe(1083)
    expect(s.threadCount).toBe(5647)
    const ws = s.rows.get(423)!
    expect(ws).toEqual({ pid: 423, cpu: 21.5, mem: 675 * 1024 ** 2, power: 23.7, threads: 21 })
    expect(s.rows.get(0)!.threads).toBe(759)
    expect(s.rows.get(15250)!.mem).toBe(503 * 1024 ** 2)
  })
})

describe('ps', () => {
  it('parses comm output with spaces in paths', () => {
    const out = [
      '    1     0 root           17:24.68 /sbin/launchd',
      '15250  1306 lucas           2:03.88 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper (Renderer)',
      '49445  7468 lucas        1:02:09.98 claude',
    ].join('\n')
    const rows = parsePs(out)
    expect(rows.get(15250)).toEqual({ pid: 15250, ppid: 1306, user: 'lucas', cpuTime: 123.88, path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper (Renderer)' })
    expect(rows.get(49445)!.cpuTime).toBeCloseTo(3729.98)
    expect(rows.get(1)!.ppid).toBe(0)
  })
  it('parses days in cputime', () => {
    expect(parsePs('  5 1 root 2-01:00:00.00 x').get(5)!.cpuTime).toBe(2 * 86400 + 3600)
  })
  it('parses args', () => {
    expect(parsePsArgs('  12 node /usr/local/bin/vite --port 3\n 13 /bin/zsh').get(12)).toBe('node /usr/local/bin/vite --port 3')
  })
})

describe('nettop', () => {
  it('splits into samples keyed by pid, names may contain dots', () => {
    const out = ',bytes_in,bytes_out,\napsd.394,10,20,\nio.tailscale.ip.926,5,6,\n,bytes_in,bytes_out,\napsd.394,1,2,\n'
    const samples = parseNettop(out)
    expect(samples).toHaveLength(2)
    expect(samples[0].get(926)).toEqual({ in: 5, out: 6 })
    expect(samples[1].get(394)).toEqual({ in: 1, out: 2 })
  })
})

describe('ioreg', () => {
  it('sums disk bytes across drivers', () => {
    const out = '"Statistics" = {"Bytes (Read)"=100,"Bytes (Write)"=7}\n"Statistics" = {"Bytes (Write)"=3,"Bytes (Read)"=50}'
    expect(parseDiskStats(out)).toEqual({ read: 150, write: 10 })
  })
  it('reads gpu utilization', () => {
    expect(parseGpu('"PerformanceStatistics" = {"Device Utilization %"=9,"Renderer Utilization %"=4}')).toBe(9)
    expect(parseGpu('nothing')).toBeNull()
  })
})

describe('pmset batt', () => {
  it('parses battery', () => {
    const out = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t83%; discharging; 4:10 remaining present: true"
    expect(parseBattery(out)).toEqual({ percent: 83, source: 'Battery Power', charging: false })
    expect(parseBattery("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charging;")!.charging).toBe(true)
    expect(parseBattery("Now drawing from 'AC Power'\n")).toBeNull()
  })
})

describe('df', () => {
  it('reads total and available KB', () => {
    const out = 'Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted on\n/dev/disk3s1s1 971350180 12000000 400000000 3% 1 2 0% /'
    expect(parseDf(out)).toEqual({ total: 971350180 * 1024, free: 400000000 * 1024 })
  })
})

describe('launchctl list', () => {
  it('maps label to pid', () => {
    const m = parseLaunchctlList('PID\tStatus\tLabel\n690\t0\tcom.apple.trustd.agent\n-\t0\tcom.foo.bar\n')
    expect(m.get('com.apple.trustd.agent')).toBe(690)
    expect(m.get('com.foo.bar')).toBeNull()
  })
})

describe('misc', () => {
  it('parses disabled services', async () => {
    const { parseDisabled } = await import('./parse.js')
    const m = parseDisabled('disabled services = {\n\t\t"com.a" => enabled\n\t\t"com.b" => disabled\n}')
    expect(m.get('com.a')).toBe(false)
    expect(m.get('com.b')).toBe(true)
  })
  it('parses swap with either decimal separator', async () => {
    const { parseSwap } = await import('./parse.js')
    expect(parseSwap('total = 2048,00M  used = 512.50M  free = 1M  (encrypted)')).toEqual({ total: 2048 * 1024 ** 2, used: 512.5 * 1024 ** 2 })
  })
})

describe('netRates', () => {
  it('turns cumulative readings into rates', async () => {
    const { netRates } = await import('./parse.js')
    const prev = new Map([[1, { in: 100, out: 10 }], [2, { in: 50, out: 50 }]])
    const cur = new Map([[1, { in: 300, out: 10 }], [2, { in: 10, out: 60 }], [3, { in: 999, out: 999 }]])
    const r = netRates(prev, cur, 10)
    expect(r.get(1)).toEqual({ in: 20, out: 0 })
    expect(r.get(2)).toEqual({ in: 0, out: 1 })
    expect(r.has(3)).toBe(false)
  })
})

describe('vm_stat', () => {
  it('computes Activity Monitor style memory', async () => {
    const { parseVmStat } = await import('./parse.js')
    const out = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages wired down:   100.\nPages purgeable:   10.\nFile-backed pages:   200.\nAnonymous pages:   1000.\nPages occupied by compressor:   50.\n'
    const p = 16384
    expect(parseVmStat(out)).toEqual({ app: 990 * p, wired: 100 * p, compressed: 50 * p, cached: 210 * p, used: 1140 * p })
  })
})

describe('netstat -ibn', () => {
  it('sums physical interfaces only, once per interface', async () => {
    const { parseNetstat } = await import('./parse.js')
    const out = [
      'Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll',
      'lo0        16384 <Link#1>                        125723     0   38090012   125723     0   38090012     0',
      'en0        1500  <Link#11>   aa:bb:cc:dd:ee:ff  1000     0   5000   900     0   700     0',
      'en0        1500  192.168.1     192.168.1.5        1000     -   5000   900     -   700     -',
      'gif0*      1280  <Link#2>                             0     0          0        0     0          0     0',
      'en5        1500  <Link#12>   aa:bb:cc:dd:ee:00  1     0   10   1     0   20     0',
      'utun3      1280  <Link#20>                       50     0   999   50     0   999     0',
    ].join('\n')
    expect(parseNetstat(out)).toEqual({ in: 5010, out: 720 })
  })
})
