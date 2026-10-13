import { useMemo, useState } from 'react'
import { usePoll } from '../api'
import { bytes, pct } from '../format'
import { Th, useSort } from '../table'
import type { StartupItem } from '../../shared/types'

type Key = 'label' | 'vendor' | 'cpu' | 'mem' | 'running'

const SCOPE: Record<StartupItem['scope'], string> = { user: 'Your agent', 'global-agent': 'Agent, all users', 'global-daemon': 'Daemon (root)' }

function disableCommand(i: StartupItem): string {
  if (i.scope === 'global-daemon') return `sudo launchctl disable system/${i.label} && sudo launchctl bootout system/${i.label}`
  return `launchctl disable gui/$(id -u)/${i.label} && launchctl bootout gui/$(id -u)/${i.label}`
}

export function StartupView() {
  const { data, error } = usePoll<StartupItem[]>('/api/startup', 10_000)
  const { sort, toggle, apply } = useSort<Key>('running')
  const [onlyRunning, setOnlyRunning] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const rows = useMemo(
    () => apply((data ?? []).filter(i => !onlyRunning || i.running), (i, k: Key) => (k === 'running' ? Number(i.running) * 1e12 + i.mem : i[k])),
    [data, onlyRunning, apply],
  )
  const running = (data ?? []).filter(i => i.running)
  const totalMem = running.reduce((s, i) => s + i.mem, 0)

  const copy = async (i: StartupItem) => {
    await navigator.clipboard?.writeText(disableCommand(i)).catch(() => {})
    setCopied(i.label)
    setTimeout(() => setCopied(c => (c === i.label ? null : c)), 1500)
  }

  return (
    <section>
      <div className="toolbar">
        <label className="check"><input type="checkbox" checked={onlyRunning} onChange={e => setOnlyRunning(e.target.checked)} /> Only running</label>
        {data && (
          <span className="muted small">
            {data.length} third-party launch items, {running.length} running right now using {bytes(totalMem)}. Apple's own live in /System and are not listed.
          </span>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <Th k="label" sort={sort} toggle={toggle}>Label</Th>
              <Th k="vendor" sort={sort} toggle={toggle}>Vendor</Th>
              <th>Type</th>
              <th>Starts</th>
              <Th k="running" sort={sort} toggle={toggle}>Status</Th>
              <Th k="cpu" sort={sort} toggle={toggle} num>CPU %</Th>
              <Th k="mem" sort={sort} toggle={toggle} num>Memory</Th>
              <th>Stop it</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(i => (
              <tr key={i.plist}>
                <td className="wide">
                  <div className="ellipsis" title={i.label}>{i.label}</div>
                  <div className="ellipsis muted small mono" title={`${i.program}\n${i.plist}`}>{i.program || i.plist}</div>
                </td>
                <td>{i.vendor}</td>
                <td className="muted">{SCOPE[i.scope]}</td>
                <td className="muted small">{[i.runAtLoad && 'at login', i.keepAlive && 'kept alive'].filter(Boolean).join(', ') || 'on demand'}</td>
                <td>
                  {i.disabled ? <span className="state off"><i aria-hidden>○</i> disabled</span> : i.running ? <span className="state on"><i aria-hidden>●</i> running{i.pids.length > 1 ? ` ×${i.pids.length}` : ''}</span> : <span className="state idle"><i aria-hidden>◌</i> idle</span>}
                </td>
                <td className="num mono">{i.running ? pct(i.cpu) : '-'}</td>
                <td className="num mono">{i.running ? bytes(i.mem) : '-'}</td>
                <td>
                  {!i.disabled && (
                    <button className="ghost" onClick={() => copy(i)} title={disableCommand(i)}>
                      {copied === i.label ? 'Copied' : 'Disable cmd'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
