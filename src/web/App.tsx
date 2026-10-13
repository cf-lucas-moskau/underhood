import { useEffect, useState } from 'react'
import { useLive } from './api'
import { Spark } from './charts'
import { bytes, duration, pct, rate } from './format'
import { AppsView } from './views/Apps'
import { ProcessesView } from './views/Processes'
import { HistoryView } from './views/History'
import { StartupView } from './views/Startup'
import type { Pressure, Snapshot, SystemPoint } from '../shared/types'

const TABS = [
  { id: 'apps', label: 'Apps' },
  { id: 'procs', label: 'Processes' },
  { id: 'history', label: 'Culprits' },
  { id: 'startup', label: 'Startup items' },
] as const
type Tab = (typeof TABS)[number]['id']

function readTab(): Tab {
  const h = location.hash.slice(1)
  return (TABS.find(t => t.id === h)?.id ?? 'apps') as Tab
}

export function App() {
  const { snap, live, connected, paused } = useLive()
  const [tab, setTab] = useState<Tab>(readTab)
  const [isPaused, setPaused] = useState(false)

  useEffect(() => {
    const on = () => setTab(readTab())
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])

  useEffect(() => {
    document.title = snap ? `${snap.host} · underhood` : 'underhood'
  }, [snap?.host])

  const togglePause = () => {
    paused.current = !paused.current
    setPaused(paused.current)
  }

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>
            <svg viewBox="0 0 32 32" width="22" height="22"><rect width="32" height="32" rx="7" fill="var(--series-1)" /><path d="M6 22 L12 14 L17 19 L26 9" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <div>
            <h1>{snap?.host ?? 'underhood'}</h1>
            <p className="muted small">{snap ? `${snap.model} · macOS ${snap.osVersion} · up ${duration(snap.uptime)}` : 'connecting…'}</p>
          </div>
        </div>
        <div className="status">
          <button className="ghost" onClick={togglePause} title="Freeze the tables so rows stop jumping. Charts keep recording.">
            {isPaused ? 'Resume' : 'Pause'}
          </button>
          <span className={`live ${connected ? 'on' : 'off'}`}>
            <span className="dot" aria-hidden />
            {connected ? (isPaused ? 'paused' : `live · ${snap?.interval ?? 2}s`) : 'offline'}
          </span>
        </div>
      </header>

      {snap ? <Tiles snap={snap} live={live} /> : <div className="tiles skeleton" />}

      <nav className="tabs" role="tablist">
        {TABS.map(t => (
          <a key={t.id} href={`#${t.id}`} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''}>
            {t.label}
          </a>
        ))}
      </nav>

      <main>
        {!snap && <p className="muted pad">Waiting for the first sample…</p>}
        {snap && tab === 'apps' && <AppsView snap={snap} />}
        {snap && tab === 'procs' && <ProcessesView snap={snap} />}
        {tab === 'history' && <HistoryView />}
        {tab === 'startup' && <StartupView />}
      </main>
    </div>
  )
}

const PRESSURE_LABEL: Record<Pressure, { label: string; icon: string }> = {
  normal: { label: 'Pressure normal', icon: '●' },
  warn: { label: 'Pressure elevated', icon: '▲' },
  critical: { label: 'Pressure critical', icon: '■' },
}

function Tiles({ snap, live }: { snap: Snapshot; live: SystemPoint[] }) {
  const s = snap.system
  const pick = (f: (p: SystemPoint) => number) => live.map(f)
  const cpu = s.cpuUser + s.cpuSys
  const memPct = (s.memUsed / s.memTotal) * 100
  const p = PRESSURE_LABEL[s.pressure]
  return (
    <section className="tiles">
      <Tile label="CPU" value={`${pct(cpu)}%`} sub={`${pct(s.cpuUser)} user · ${pct(s.cpuSys)} sys · load ${s.load[0].toFixed(2)}`}>
        <Spark values={pick(x => x.cpu)} max={100} />
      </Tile>
      <Tile label="Memory" value={bytes(s.memUsed)} sub={
        <>
          <span className={`pressure ${s.pressure}`}><span aria-hidden>{p.icon}</span> {p.label}</span>
          {' · '}{bytes(s.memCached)} cached{s.swapUsed > 0 ? ` · ${bytes(s.swapUsed)} swap` : ''}
        </>
      } of={`of ${bytes(s.memTotal, 0)} (${memPct.toFixed(0)}%)`}>
        <Spark values={pick(x => x.mem)} max={s.memTotal} />
      </Tile>
      <Tile label="GPU" value={s.gpu == null ? 'n/a' : `${s.gpu}%`} sub={`${s.procCount} processes · ${s.threadCount} threads`}>
        <Spark values={pick(x => x.gpu ?? 0)} max={100} />
      </Tile>
      <Tile label="Network" value={rate(s.netIn + s.netOut)} sub={`↓ ${rate(s.netIn)} · ↑ ${rate(s.netOut)}`}>
        <Spark values={pick(x => x.netIn + x.netOut)} />
      </Tile>
      <Tile label="Disk" value={rate(s.diskRead + s.diskWrite)} sub={`R ${rate(s.diskRead)} · W ${rate(s.diskWrite)} · ${bytes(s.diskFree, 0)} free`}>
        <Spark values={pick(x => x.diskRead + x.diskWrite)} />
      </Tile>
      {s.battery && (
        <Tile label="Battery" value={`${s.battery.percent}%`} sub={`${s.battery.source}${s.battery.charging ? ' · charging' : ''}`} />
      )}
    </section>
  )
}

function Tile({ label, value, sub, of, children }: { label: string; value: string; sub: React.ReactNode; of?: string; children?: React.ReactNode }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">
        {value} {of && <span className="of">{of}</span>}
      </div>
      <div className="tile-sub">{sub}</div>
      {children}
    </div>
  )
}
