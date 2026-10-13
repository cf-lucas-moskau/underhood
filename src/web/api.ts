import { useEffect, useRef, useState } from 'react'
import type { Snapshot, SystemPoint } from '../shared/types'

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

export function useLive() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [live, setLive] = useState<SystemPoint[]>([])
  const [connected, setConnected] = useState(false)
  const paused = useRef(false)

  useEffect(() => {
    getJSON<SystemPoint[]>('/api/live').then(setLive).catch(() => {})
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
      if (!paused.current) setSnap(s)
    }
    return () => es.close()
  }, [])

  return { snap, live, connected, paused }
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
