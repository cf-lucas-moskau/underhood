import { useEffect, useRef, useState } from 'react'
import type { Kind, Proc, RecentSample, Snapshot, SystemPoint } from '../shared/types'
import { compactRecent } from '../shared/recent'

export async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(path)
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}

export async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = await r.json()
  if (!r.ok) throw new Error(data.error ?? r.statusText)
  return data
}

const LIVE_POINTS = 450
const RECENT_SAMPLES = 150
const SEEN_MS = 120_000

/** What we last knew about groups and processes, so ones that just exited can still be shown. */
export interface Seen {
  groups: Map<string, { kind: Kind; at: number }>
  procs: Map<string, { proc: Proc; at: number }>
}

export function useLive() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [live, setLive] = useState<SystemPoint[]>([])
  const [recent, setRecent] = useState<RecentSample[]>([])
  const [connected, setConnected] = useState(false)
  const paused = useRef(false)
  const recentRef = useRef<RecentSample[]>([])
  const seen = useRef<Seen>({ groups: new Map(), procs: new Map() })

  useEffect(() => {
    getJSON<SystemPoint[]>('/api/live').then(setLive).catch(() => {})
    getJSON<RecentSample[]>('/api/recent')
      .then(seed => {
        const newest = recentRef.current[0]?.ts ?? Infinity
        recentRef.current = [...seed.filter(x => x.ts < newest), ...recentRef.current].slice(-RECENT_SAMPLES)
        if (!paused.current) setRecent(recentRef.current)
      })
      .catch(() => {})
    const es = new EventSource('/api/stream')
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.onmessage = e => {
      const s = JSON.parse(e.data) as Snapshot
      setConnected(true)
      const sys = s.system
      setLive(prev => {
        if (prev.length && prev[prev.length - 1].ts >= s.ts) return prev
        const next = [...prev, {
          ts: s.ts, cpu: sys.cpuUser + sys.cpuSys, cpuSys: sys.cpuSys, mem: sys.memUsed, swap: sys.swapUsed,
          gpu: sys.gpu, netIn: sys.netIn, netOut: sys.netOut, diskRead: sys.diskRead, diskWrite: sys.diskWrite,
        }]
        return next.length > LIVE_POINTS ? next.slice(-LIVE_POINTS) : next
      })
      const sn = seen.current
      for (const g of s.groups) sn.groups.set(g.name, { kind: g.kind, at: s.ts })
      for (const p of s.procs) if (p.cpu >= 0.05) sn.procs.set(String(p.pid), { proc: p, at: s.ts })
      for (const [k, v] of sn.groups) if (v.at < s.ts - SEEN_MS) sn.groups.delete(k)
      for (const [k, v] of sn.procs) if (v.at < s.ts - SEEN_MS) sn.procs.delete(k)
      const r = recentRef.current
      if (!r.length || r[r.length - 1].ts < s.ts) recentRef.current = [...r, compactRecent(s)].slice(-RECENT_SAMPLES)
      if (!paused.current) {
        setSnap(s)
        setRecent(recentRef.current)
      }
    }
    return () => es.close()
  }, [])

  return { snap, live, recent, connected, paused, seen: seen.current }
}

export function usePoll<T>(path: string | null, everyMs: number): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!path) return
    let alive = true
    const load = () => getJSON<T>(path).then(d => alive && (setData(d), setError(null))).catch(e => alive && setError(String(e)))
    load()
    const t = setInterval(load, everyMs)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [path, everyMs])
  return { data, error }
}
