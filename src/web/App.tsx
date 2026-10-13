import { useEffect, useMemo, useState } from 'react'
import { useLive, type Seen } from './api'
import { isSpike, summarize, windowStats, type Activity } from './smooth'
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

export const SMOOTHING = [
  { id: 'off', label: 'Off', ms: 0 },
  { id: '10s', label: '10s', ms: 10_000 },
  { id: '30s', label: '30s', ms: 30_000 },
  { id: '1m', label: '1m', ms: 60_000 },
] as const
type SmoothId = (typeof SMOOTHING)[number]['id']

function readSmoothing(): SmoothId {
  try {
    const v = localStorage.getItem('underhood.smoothing')
    if (SMOOTHING.some(x => x.id === v)) return v as SmoothId
  } catch { /* storage blocked */ }
  return '30s'
}

export interface Smooth {
  ms: number
  /** "30s avg" or "now" */
  label: string
  /** averages over the selected window */
  groups: Map<string, Activity>
  procs: Map<string, Activity>
  /** last minute regardless of smoothing: peaks, spike flags, sparklines */
  groupTrend: Map<string, Activity>
  procTrend: Map<string, Activity>
  seen: Seen
}

export const TREND_MS = 60_000

function readTab(): Tab {
  const h = location.hash.slice(1)
  return (TABS.find(t => t.id === h)?.id ?? 'apps') as Tab
}

export function App() {
  const { snap, live, recent, connected, paused, seen } = useLive()
  const [tab, setTab] = useState<Tab>(readTab)
  const [isPaused, setPaused] = useState(false)
  const [smoothId, setSmoothId] = useState<SmoothId>(readSmoothing)
  const ms = SMOOTHING.find(x => x.id === smoothId)!.ms

  const smooth: Smooth = useMemo(
    () => ({
      ms,
      label: ms ? `${smoothId} avg` : 'now',
      groups: summarize(recent, 'g', ms),
      procs: summarize(recent, 'p', ms),
      groupTrend: summarize(recent, 'g', TREND_MS),
      procTrend: summarize(recent, 'p', TREND_MS),
      seen,
    }),
    [recent, ms, smoothId, seen],
  )

  const pickSmoothing = (id: SmoothId) => {
    setSmoothId(id)
    try {
      localStorage.setItem('underhood.smoothing', id)
    } catch { /* storage blocked */ }
  }

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
          <div className="smoothing" title="Numbers and sort order use the average over this window. Peaks and sparklines still show every sample.">
            <span className="muted small">Average over</span>
            <div className="seg" role="group" aria-label="Averaging window">
              {SMOOTHING.map(x => (
                <button key={x.id} className={x.id === smoothId ? 'on' : ''} aria-pressed={x.id === smoothId} onClick={() => pickSmoothing(x.id)}>{x.label}</button>
              ))}
            </div>
          </div>
          <button className="ghost" onClick={togglePause} title="Freeze the tables. Charts keep recording.">
            {isPaused ? 'Resume' : 'Pause'}
          </button>
          <span className={`live ${connected ? 'on' : 'off'}`}>
            <span className="dot" aria-hidden />
            {connected ? (isPaused ? 'paused' : `live · ${snap?.interval ?? 2}s`) : 'offline'}
          </span>
        </div>
      </header>

      {snap ? <Tiles snap={snap} live={live} ms={ms} /> : <div className="tiles skeleton" />}

      <nav className="tabs" role="tablist">
        {TABS.map(t => (
          <a key={t.id} href={`#${t.id}`} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''}>
            {t.label}
          </a>
        ))}
      </nav>

      <main>
        {!snap && <p className="muted pad">Waiting for the first sample…</p>}
        {snap && tab === 'apps' && <AppsView snap={snap} smooth={smooth} />}
        {snap && tab === 'procs' && <ProcessesView snap={snap} smooth={smooth} />}
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

function Tiles({ snap, live, ms }: { snap: Snapshot; live: SystemPoint[]; ms: number }) {
  const s = snap.system
  const pick = (f: (p: SystemPoint) => number) => live.map(f)
  const stat = (f: (p: SystemPoint) => number) => windowStats(live, f, ms)
  const cpu = stat(x => x.cpu)
  const gpu = stat(x => x.gpu ?? 0)
  const net = stat(x => x.netIn + x.netOut)
  const disk = stat(x => x.diskRead + x.diskWrite)
  const memPct = (s.memUsed / s.memTotal) * 100
  const p = PRESSURE_LABEL[s.pressure]
  const peak = (st: { avg: number; peak: number }, fmt: (v: number) => string, spikeMin = 0) =>
    ms > 0 && <Peak value={fmt(st.peak)} spike={isSpike(st.avg, st.peak, spikeMin)} />
  return (
    <section className="tiles">
      <Tile label="CPU" value={`${pct(cpu.avg)}%`} sub={<>{peak(cpu, v => `${pct(v)}%`, 50)}{`${pct(s.cpuUser)} user · ${pct(s.cpuSys)} sys · load ${s.load[0].toFixed(2)}`}</>}>
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
      <Tile label="GPU" value={s.gpu == null ? 'n/a' : `${pct(gpu.avg)}%`} sub={<>{s.gpu != null && peak(gpu, v => `${pct(v)}%`, 50)}{`${s.procCount} processes`}</>}>
        <Spark values={pick(x => x.gpu ?? 0)} max={100} />
      </Tile>
      <Tile label="Network" value={rate(net.avg)} sub={<>{peak(net, rate, 1e6)}{`↓ ${rate(s.netIn)} · ↑ ${rate(s.netOut)}`}</>}>
        <Spark values={pick(x => x.netIn + x.netOut)} />
      </Tile>
      <Tile label="Disk" value={rate(disk.avg)} sub={<>{peak(disk, rate, 1e7)}{`R ${rate(s.diskRead)} · W ${rate(s.diskWrite)} · ${bytes(s.diskFree, 0)} free`}</>}>
        <Spark values={pick(x => x.diskRead + x.diskWrite)} />
      </Tile>
      {s.battery && (
        <Tile label="Battery" value={`${s.battery.percent}%`} sub={`${s.battery.source}${s.battery.charging ? ' · charging' : ''}`} />
      )}
    </section>
  )
}

function Peak({ value, spike }: { value: string; spike: boolean }) {
  return (
    <span className={`peak ${spike ? 'spike' : ''}`}>
      {spike && <span aria-hidden>▲ </span>}peak {value}
      <br />
    </span>
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
