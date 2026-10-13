import type { Kind } from '../shared/types.js'

export interface ProcInfo { pid: number; ppid: number; path: string; args: string; user: string }

const SHELLS = new Set(['bash', 'zsh', 'sh', 'fish', 'dash', 'tcsh', 'csh', 'ksh', 'nu', 'login', 'sudo'])
const INTERPRETERS = /^(node|bun|deno|python[\d.]*|ruby|perl|php|java|Python)$/

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1).replace(/^-/, '')

export function bundleName(path: string): string | null {
  const i = path.indexOf('.app/')
  if (i < 0) return path.endsWith('.app') ? base(path.slice(0, -4)) : null
  if (path.slice(0, i).includes('.framework/')) return null
  return base(path.slice(0, i))
}

export function displayName(path: string, args: string): string {
  const name = base(path)
  if (!INTERPRETERS.test(name)) return name
  const script = args.split(/\s+/).slice(1).find(a => a && !a.startsWith('-'))
  return script ? `${name} ${base(script)}` : name
}

export function classify(path: string, user: string): Kind {
  if (path.startsWith('/System/Applications/')) return 'app'
  if (/^\/(System|sbin|bin|Library\/Apple)\/|^\/usr\/(?!local\/)/.test(path)) return 'system'
  if (!path.includes('/')) return user === 'root' || user.startsWith('_') ? 'system' : 'cli'
  if (bundleName(path)) return 'app'
  if (/^\/(Library|Applications)\//.test(path)) return 'thirdparty'
  return 'cli'
}

/**
 * Which logical "thing" a process belongs to. Helpers and children roll up to the
 * .app that spawned them; shells are a boundary, so whatever you run in a terminal
 * is its own group; plain daemons group by their topmost ancestor below launchd.
 */
export function attribute(pid: number, procs: Map<number, ProcInfo>): string {
  const self = procs.get(pid)
  if (!self) return String(pid)
  let top: ProcInfo | null = null
  const seen = new Set<number>()
  for (let p: ProcInfo | undefined = self; p && p.pid > 1 && !seen.has(p.pid); p = procs.get(p.ppid)) {
    seen.add(p.pid)
    const bundle = bundleName(p.path)
    if (bundle) return bundle
    if (SHELLS.has(base(p.path))) {
      if (top) return displayName(top.path, top.args)
      continue
    }
    top = p
  }
  const pick = top ?? self
  return displayName(pick.path, pick.args)
}
