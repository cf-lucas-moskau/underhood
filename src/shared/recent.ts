import type { RecentSample, Snapshot } from './types.js'

const r1 = (n: number) => Math.round(n * 10) / 10

export function compactRecent(snap: Pick<Snapshot, 'ts' | 'groups' | 'procs'>): RecentSample {
  const g: RecentSample['g'] = {}
  const p: RecentSample['p'] = {}
  for (const x of snap.groups) {
    const net = x.netIn + x.netOut
    if (x.cpu >= 0.05 || net > 0) g[x.name] = [r1(x.cpu), r1(x.power), Math.round(net)]
  }
  for (const x of snap.procs) {
    const net = x.netIn + x.netOut
    if (x.cpu >= 0.05 || net > 0) p[x.pid] = [r1(x.cpu), r1(x.power), Math.round(net)]
  }
  return { ts: snap.ts, g, p }
}
