import { useState } from 'react'
import { postJSON, usePoll } from '../api'
import { TimeChart } from '../charts'
import { bytes, clock, dayClock, pct } from '../format'
import type { Proc, SeriesPoint } from '../../shared/types'

const WINDOWS = ['1h', '6h', '24h', '7d'] as const

/** History charts and the live process list for one group. */
export function GroupDetail({ name, procs, allowKill }: { name: string; procs?: Proc[]; allowKill: boolean }) {
  const [win, setWin] = useState<(typeof WINDOWS)[number]>('1h')
  const { data } = usePoll<SeriesPoint[]>(`/api/series?group=${encodeURIComponent(name)}&window=${win}`, 30_000)
  const ts = data?.map(p => p.ts) ?? []
  const fmtTime = win === '7d' ? dayClock : clock
  return (
    <div className="detail">
      <div className="detail-head">
        <div className="seg" role="group" aria-label="History window">
          {WINDOWS.map(w => (
            <button key={w} className={w === win ? 'on' : ''} aria-pressed={w === win} onClick={() => setWin(w)}>{w}</button>
          ))}
        </div>
        {allowKill && procs && procs.length > 0 && <KillButtons label={`all ${procs.length} process${procs.length > 1 ? 'es' : ''}`} target={{ group: name }} />}
      </div>
      {data && data.length > 1 ? (
        <div className="grid2">
          <TimeChart label={`${name} CPU`} ts={ts} series={[{ name: 'CPU', color: 'var(--series-1)', values: data.map(p => p.cpu) }]} format={v => `${pct(v)}%`} height={120} timeFormat={fmtTime} />
          <TimeChart label={`${name} memory`} ts={ts} series={[{ name: 'Memory', color: 'var(--series-2)', values: data.map(p => p.mem) }]} format={v => bytes(v)} height={120} timeFormat={fmtTime} />
        </div>
      ) : (
        <p className="muted small">History appears after the first full minute of sampling.</p>
      )}
      {procs && procs.length > 0 && (
        <table className="sub">
          <thead>
            <tr><th>PID</th><th>Process</th><th className="num">CPU %</th><th className="num">Memory</th><th>User</th>{allowKill && <th />}</tr>
          </thead>
          <tbody>
            {[...procs].sort((a, b) => b.cpu - a.cpu || b.mem - a.mem).map(p => (
              <tr key={p.pid}>
                <td className="mono muted">{p.pid}</td>
                <td><div className="ellipsis" title={p.args}>{p.name}</div><div className="ellipsis muted small mono" title={p.args}>{p.args}</div></td>
                <td className="num mono">{pct(p.cpu)}</td>
                <td className="num mono">{bytes(p.mem)}</td>
                <td className="muted">{p.user}</td>
                {allowKill && <td className="num"><KillButtons target={{ pid: p.pid }} compact /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function KillButtons({ target, label, compact }: { target: { pid?: number; group?: string }; label?: string; compact?: boolean }) {
  const [msg, setMsg] = useState<string | null>(null)
  const go = async (signal: 'TERM' | 'KILL') => {
    const what = target.group != null ? `"${target.group}" (${label})` : `PID ${target.pid}`
    if (!confirm(`${signal === 'KILL' ? 'Force kill' : 'Quit'} ${what}?`)) return
    try {
      const r = await postJSON<{ results: { ok: boolean; error?: string }[] }>('/api/kill', { ...target, signal })
      const failed = r.results.filter(x => !x.ok)
      setMsg(failed.length ? `${failed.length} failed (${failed[0].error})` : 'sent')
    } catch (e) {
      setMsg(String((e as Error).message))
    }
  }
  return (
    <span className="kill">
      <button className="ghost danger" onClick={() => go('TERM')}>{compact ? 'Quit' : `Quit ${label ?? ''}`}</button>
      <button className="ghost danger" onClick={() => go('KILL')} title="SIGKILL: no chance to save state">Force</button>
      {msg && <span className="muted small">{msg}</span>}
    </span>
  )
}
