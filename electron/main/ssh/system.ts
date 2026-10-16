import type { SshSession } from './session'
import type { DiskUsage, ProcessInfo, SystemResources } from '../types'

const SCRIPT = `
echo "@@hostname"; hostname
echo "@@os"; (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || uname -s
echo "@@kernel"; uname -r
echo "@@uptime"; uptime -p 2>/dev/null || uptime
echo "@@load"; cat /proc/loadavg 2>/dev/null
echo "@@cpumodel"; (grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2) || true
echo "@@cores"; nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo
echo "@@stat1"; head -n1 /proc/stat 2>/dev/null
sleep 0.5
echo "@@stat2"; head -n1 /proc/stat 2>/dev/null
echo "@@meminfo"; grep -E '^(MemTotal|MemAvailable|MemFree|Buffers|Cached|SwapTotal|SwapFree):' /proc/meminfo 2>/dev/null
echo "@@disk"; df -P -k -x tmpfs -x devtmpfs -x overlay -x squashfs 2>/dev/null | tail -n +2 || df -P -k | tail -n +2
echo "@@ps"; ps -eo user:20,pid,pcpu,pmem,args --sort=-pcpu 2>/dev/null | head -n 16 | tail -n +2
`

function sections(stdout: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  let current = ''
  for (const line of stdout.split('\n')) {
    if (line.startsWith('@@')) {
      current = line.slice(2).trim()
      map.set(current, [])
    } else if (current) {
      map.get(current)!.push(line)
    }
  }
  return map
}

function cpuUsage(a?: string, b?: string): number | null {
  const parse = (line?: string): number[] | null => {
    if (!line || !line.startsWith('cpu')) return null
    return line.trim().split(/\s+/).slice(1).map(Number)
  }
  const s1 = parse(a)
  const s2 = parse(b)
  if (!s1 || !s2) return null
  const idle = (s: number[]): number => (s[3] || 0) + (s[4] || 0)
  const total = (s: number[]): number => s.reduce((sum, v) => sum + (v || 0), 0)
  const dt = total(s2) - total(s1)
  if (dt <= 0) return null
  return Math.max(0, Math.min(100, ((dt - (idle(s2) - idle(s1))) / dt) * 100))
}

export async function getSystemResources(session: SshSession): Promise<SystemResources> {
  const result = await session.exec(SCRIPT)
  const s = sections(result.stdout)
  const first = (key: string): string => (s.get(key) || []).find((l) => l.trim())?.trim() || ''

  const mem = new Map<string, number>()
  for (const line of s.get('meminfo') || []) {
    const m = line.match(/^(\w+):\s+(\d+)/)
    if (m) mem.set(m[1], Number(m[2]) * 1024)
  }
  const memTotal = mem.get('MemTotal') || 0
  const memAvailable =
    mem.get('MemAvailable') ??
    (mem.get('MemFree') || 0) + (mem.get('Buffers') || 0) + (mem.get('Cached') || 0)
  const swapTotal = mem.get('SwapTotal') || 0

  const seen = new Set<string>()
  const disks: DiskUsage[] = []
  for (const line of s.get('disk') || []) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 6) continue
    const [filesystem, size, used, available] = parts
    const mount = parts.slice(5).join(' ')
    if (seen.has(mount) || Number(size) === 0) continue
    seen.add(mount)
    disks.push({
      filesystem,
      size: Number(size) * 1024,
      used: Number(used) * 1024,
      available: Number(available) * 1024,
      mount
    })
  }

  const processes: ProcessInfo[] = []
  for (const line of s.get('ps') || []) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 5) continue
    processes.push({
      user: parts[0],
      pid: parts[1],
      cpu: Number(parts[2]) || 0,
      mem: Number(parts[3]) || 0,
      command: parts.slice(4).join(' ')
    })
  }

  return {
    hostname: first('hostname') || 'unknown',
    os: first('os'),
    kernel: first('kernel'),
    uptime: first('uptime').replace(/^up\s+/, ''),
    loadAvg: first('load')
      .split(/\s+/)
      .slice(0, 3)
      .map(Number)
      .filter((n) => Number.isFinite(n)),
    cpuModel: first('cpumodel'),
    cpuCores: Number(first('cores')) || 0,
    cpuUsage: cpuUsage(first('stat1'), first('stat2')),
    memTotal,
    memUsed: Math.max(0, memTotal - memAvailable),
    memAvailable,
    swapTotal,
    swapUsed: Math.max(0, swapTotal - (mem.get('SwapFree') || 0)),
    disks,
    processes
  }
}
