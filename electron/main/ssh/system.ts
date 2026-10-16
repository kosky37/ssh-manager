import type { SshSession } from './session'
import type { SystemResources } from '../types'

export async function getSystemResources(session: SshSession): Promise<SystemResources> {
  const script = `
hostname
uptime -p 2>/dev/null || uptime
cat /proc/loadavg 2>/dev/null | awk '{print $1, $2, $3}'
(lscpu 2>/dev/null | awk -F: '/Model name/{gsub(/^[ \\t]+/,"",$2); print $2; exit}') || echo "n/a"
nproc 2>/dev/null || echo "n/a"
free -h | awk '/Mem:/{print $2"|"$3"|"$7}'
free -h | awk '/Swap:/{print $2"|"$3}'
df -h --total 2>/dev/null | tail -n +2 || df -h | tail -n +2
ps aux --sort=-%cpu 2>/dev/null | head -n 11 || ps aux | head -n 11
`
  const result = await session.exec(script)
  const lines = result.stdout.split('\n')

  const hostname = lines[0]?.trim() || 'unknown'
  const uptime = lines[1]?.trim() || ''
  const loadAvg = lines[2]?.trim() || ''
  const cpuModel = lines[3]?.trim() || ''
  const cpuCores = lines[4]?.trim() || ''

  const memParts = (lines[5] || '').split('|')
  const swapParts = (lines[6] || '').split('|')

  // Remaining: disk lines until we hit ps header "USER" typically
  const rest = lines.slice(7)
  const psIdx = rest.findIndex((l: string) => l.startsWith('USER') || l.includes('%CPU'))
  const diskLines = psIdx >= 0 ? rest.slice(0, psIdx) : rest.slice(0, Math.max(0, rest.length - 11))
  const topLines = psIdx >= 0 ? rest.slice(psIdx) : rest.slice(-11)

  return {
    hostname,
    uptime,
    loadAvg,
    cpuModel,
    cpuCores,
    memTotal: memParts[0] || '',
    memUsed: memParts[1] || '',
    memAvailable: memParts[2] || '',
    swapTotal: swapParts[0] || '',
    swapUsed: swapParts[1] || '',
    disk: diskLines.join('\n').trim(),
    topProcesses: topLines.join('\n').trim()
  }
}
