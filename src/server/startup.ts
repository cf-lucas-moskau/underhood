import { execFile } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Snapshot, StartupItem } from '../shared/types.js'
import { parseDisabled, parseLaunchctlList } from './parse.js'

const run = promisify(execFile)

const DIRS: { dir: string; scope: StartupItem['scope'] }[] = [
  { dir: join(homedir(), 'Library/LaunchAgents'), scope: 'user' },
  { dir: '/Library/LaunchAgents', scope: 'global-agent' },
  { dir: '/Library/LaunchDaemons', scope: 'global-daemon' },
]

interface Plist { Label?: string; Program?: string; ProgramArguments?: string[]; RunAtLoad?: boolean; KeepAlive?: unknown; Disabled?: boolean }
/** com.adobe.foo -> adobe; TEAMID1234.com.microsoft.x -> microsoft */
export function vendorOf(label: string): string {
  const parts = label.split('.')
  if (/^[A-Z0-9]{10}$/.test(parts[0])) parts.shift()
  return parts[1] ?? parts[0]
}

const cache = new Map<string, { mtime: number; plist: Plist | null }>()

async function readPlist(path: string): Promise<Plist | null> {
  let mtime = 0
  try {
    mtime = statSync(path).mtimeMs
  } catch {
    return null
  }
  const hit = cache.get(path)
  if (hit && hit.mtime === mtime) return hit.plist
  let plist: Plist | null = null
  try {
    plist = JSON.parse((await run('plutil', ['-convert', 'json', '-o', '-', path])).stdout)
  } catch { /* unreadable or binary data plutil can't map to JSON */ }
  cache.set(path, { mtime, plist })
  return plist
}

/** Third-party launch agents and daemons: what starts behind your back, and what it costs right now. */
export async function startupItems(snap: Snapshot | null): Promise<StartupItem[]> {
  const uid = process.getuid?.() ?? 501
  const [list, disabledUser, disabledSystem] = await Promise.all([
    run('launchctl', ['list']).then(r => parseLaunchctlList(r.stdout)).catch(() => new Map<string, number | null>()),
    run('launchctl', ['print-disabled', `gui/${uid}`]).then(r => parseDisabled(r.stdout)).catch(() => new Map<string, boolean>()),
    run('launchctl', ['print-disabled', 'system']).then(r => parseDisabled(r.stdout)).catch(() => new Map<string, boolean>()),
  ])
  const procs = snap?.procs ?? []
  const byPath = new Map<string, number[]>()
  for (const p of procs) byPath.set(p.path, [...(byPath.get(p.path) ?? []), p.pid])
  const byPid = new Map(procs.map(p => [p.pid, p]))

  const items: StartupItem[] = []
  for (const { dir, scope } of DIRS) {
    let files: string[] = []
    try {
      files = readdirSync(dir).filter(f => f.endsWith('.plist'))
    } catch {
      continue
    }
    for (const f of files) {
      const path = join(dir, f)
      const pl = await readPlist(path)
      const label = pl?.Label ?? f.replace(/\.plist$/, '')
      const program = pl?.Program ?? pl?.ProgramArguments?.[0] ?? ''
      const pids = new Set<number>(program ? byPath.get(program) ?? [] : [])
      const listed = list.get(label)
      if (listed) pids.add(listed)
      const live = [...pids].map(pid => byPid.get(pid)).filter(p => !!p)
      const disabled = (scope === 'global-daemon' ? disabledSystem : disabledUser).get(label) ?? pl?.Disabled ?? false
      items.push({
        label,
        scope,
        plist: path,
        program,
        runAtLoad: !!pl?.RunAtLoad,
        keepAlive: !!pl?.KeepAlive,
        disabled,
        running: live.length > 0,
        pids: live.map(p => p.pid),
        cpu: live.reduce((s, p) => s + p.cpu, 0),
        mem: live.reduce((s, p) => s + p.mem, 0),
        vendor: vendorOf(label),
        group: live[0]?.group ?? null,
      })
    }
  }
  return items.sort((a, b) => Number(b.running) - Number(a.running) || b.mem - a.mem || a.label.localeCompare(b.label))
}
