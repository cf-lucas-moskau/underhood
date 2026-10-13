import { describe, expect, it } from 'vitest'
import { bundleName, classify, attribute, displayName, type ProcInfo } from './group.js'

describe('bundleName', () => {
  it('takes the outermost .app bundle', () => {
    expect(bundleName('/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)')).toBe('Google Chrome')
    expect(bundleName('/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder')).toBe('Finder')
    expect(bundleName('/usr/libexec/logd')).toBeNull()
  })
  it('ignores app bundles buried in frameworks (Python.app is an interpreter)', () => {
    expect(bundleName('/Library/Frameworks/Python.framework/Versions/3.12/Resources/Python.app/Contents/MacOS/Python')).toBeNull()
  })
})

describe('displayName', () => {
  it('uses the script for interpreters', () => {
    expect(displayName('/opt/homebrew/bin/node', 'node /Users/x/proj/node_modules/.bin/vite --port 3')).toBe('node vite')
    expect(displayName('/usr/bin/python3', '/usr/bin/python3 -u server.py')).toBe('python3 server.py')
    expect(displayName('/usr/libexec/logd', '/usr/libexec/logd')).toBe('logd')
    expect(displayName('claude', 'claude')).toBe('claude')
  })
})

describe('classify', () => {
  it('separates apple from third party', () => {
    expect(classify('/usr/libexec/logd', 'root')).toBe('system')
    expect(classify('/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder', 'lucas')).toBe('system')
    expect(classify('/System/Applications/Mail.app/Contents/MacOS/Mail', 'lucas')).toBe('app')
    expect(classify('kernel_task', 'root')).toBe('system')
    expect(classify('/Applications/Slack.app/Contents/MacOS/Slack', 'lucas')).toBe('app')
    expect(classify('/Library/Application Support/Fortinet/fmon', 'root')).toBe('thirdparty')
    expect(classify('/opt/homebrew/bin/syncthing', 'lucas')).toBe('cli')
    expect(classify('claude', 'lucas')).toBe('cli')
  })
})

describe('attribute', () => {
  const p = (pid: number, ppid: number, path: string, args = path): ProcInfo => ({ pid, ppid, path, args, user: 'lucas' })
  const procs = new Map<number, ProcInfo>([
    [1, p(1, 0, '/sbin/launchd')],
    [10, p(10, 1, '/Applications/Visual Studio Code.app/Contents/MacOS/Electron')],
    [11, p(11, 10, '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper')],
    [12, p(12, 11, '/opt/homebrew/bin/node', 'node tsserver.js')],
    [20, p(20, 1, '/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal')],
    [21, p(21, 20, '/usr/bin/login')],
    [22, p(22, 21, '-bash')],
    [23, p(23, 22, 'claude')],
    [24, p(24, 23, '/opt/homebrew/bin/node', 'node /x/vite.js')],
    [30, p(30, 1, '/usr/libexec/mdworker_shared')],
    [31, p(31, 1, '/usr/libexec/mdworker_shared')],
    [40, p(40, 1, '/opt/homebrew/bin/syncthing')],
    [41, p(41, 40, '/opt/homebrew/bin/syncthing', 'syncthing serve')],
    [50, p(50, 99999, '/usr/bin/orphan')],
  ])
  it('rolls helpers up to their app', () => {
    expect(attribute(11, procs)).toBe('Visual Studio Code')
  })
  it('rolls non-bundle children into the app that spawned them', () => {
    expect(attribute(12, procs)).toBe('Visual Studio Code')
  })
  it('stops at shells so terminal commands are their own group', () => {
    expect(attribute(23, procs)).toBe('claude')
    expect(attribute(24, procs)).toBe('claude')
    expect(attribute(20, procs)).toBe('Terminal')
    expect(attribute(22, procs)).toBe('Terminal')
  })
  it('groups daemons by their topmost ancestor below launchd', () => {
    expect(attribute(30, procs)).toBe('mdworker_shared')
    expect(attribute(41, procs)).toBe('syncthing')
  })
  it('survives missing parents', () => {
    expect(attribute(50, procs)).toBe('orphan')
  })
})
