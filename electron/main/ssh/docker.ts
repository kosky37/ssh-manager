import type { SshSession } from './session'
import type { DockerContainer, DockerInspect, DockerStats, ExecResult } from '../types'
import { isRootUser, sudoExec } from './elevate'

type DockerMode = 'plain' | 'sudo'

const dockerMode = new WeakMap<SshSession, DockerMode>()

async function hasDocker(session: SshSession): Promise<boolean> {
  const result = await session.exec('command -v docker >/dev/null 2>&1 && echo yes || echo no')
  return result.stdout.trim() === 'yes'
}

function looksLikePermissionError(result: ExecResult): boolean {
  const text = `${result.stderr}\n${result.stdout}`.toLowerCase()
  return (
    text.includes('permission denied') ||
    text.includes('connect to the docker daemon') ||
    text.includes('cannot connect to the docker api') ||
    text.includes('got permission denied while trying to connect')
  )
}

async function runDocker(
  session: SshSession,
  mode: DockerMode,
  args: string,
  timeoutMs?: number
): Promise<ExecResult> {
  if (mode === 'sudo') {
    return sudoExec(session, `docker ${args}`, timeoutMs)
  }
  return session.exec(`docker ${args}`, timeoutMs)
}

async function dockerExec(
  session: SshSession,
  args: string,
  timeoutMs?: number
): Promise<ExecResult> {
  const cached = dockerMode.get(session)
  if (cached) {
    return runDocker(session, cached, args, timeoutMs)
  }

  // Non-root: elevate by default (password via sudo -S when available).
  if (!isRootUser(session)) {
    const elevated = await runDocker(session, 'sudo', args, timeoutMs)
    if (elevated.code === 0 || !looksLikePermissionError(elevated)) {
      dockerMode.set(session, 'sudo')
      return elevated
    }

    const plain = await runDocker(session, 'plain', args, timeoutMs)
    if (plain.code === 0) {
      dockerMode.set(session, 'plain')
      return plain
    }

    return {
      ...elevated,
      stderr:
        (elevated.stderr || plain.stderr || '').trim() ||
        'Docker needs root. Check sudo access for this user, or add them to the docker group.'
    }
  }

  const result = await runDocker(session, 'plain', args, timeoutMs)
  if (result.code === 0 || !looksLikePermissionError(result)) {
    dockerMode.set(session, 'plain')
    return result
  }

  const elevated = await runDocker(session, 'sudo', args, timeoutMs)
  dockerMode.set(session, elevated.code === 0 ? 'sudo' : 'plain')
  return elevated
}

function parseTable(stdout: string): string[][] {
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
}

export async function listContainers(session: SshSession): Promise<{
  available: boolean
  containers: DockerContainer[]
  error?: string
}> {
  if (!(await hasDocker(session))) {
    return { available: false, containers: [] }
  }

  const fmt =
    '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.State}}\t{{.Ports}}'
  const result = await dockerExec(session, `ps -a --format '${fmt}'`)

  if (result.code !== 0) {
    return {
      available: true,
      containers: [],
      error: result.stderr || result.stdout || 'Failed to list containers'
    }
  }

  const containers = parseTable(result.stdout).map((cols) => ({
    id: cols[0] || '',
    name: cols[1] || '',
    image: cols[2] || '',
    status: cols[3] || '',
    state: cols[4] || '',
    ports: cols[5] || ''
  }))

  return { available: true, containers }
}

export async function containerStats(session: SshSession): Promise<DockerStats[]> {
  if (!(await hasDocker(session))) return []

  const fmt =
    '{{.ID}}\t{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}'
  const result = await dockerExec(session, `stats --no-stream --format '${fmt}'`)
  if (result.code !== 0) return []

  return parseTable(result.stdout).map((cols) => ({
    id: cols[0] || '',
    name: (cols[1] || '').replace(/^\//, ''),
    cpu: cols[2] || '',
    memUsage: cols[3] || '',
    memPerc: cols[4] || '',
    netIO: cols[5] || '',
    blockIO: cols[6] || ''
  }))
}

export async function containerLogs(
  session: SshSession,
  containerId: string,
  lines = 200
): Promise<string> {
  const result = await dockerExec(
    session,
    `logs --tail ${lines} ${JSON.stringify(containerId)} 2>&1`
  )
  return result.stdout || result.stderr
}

export async function containerInspect(
  session: SshSession,
  containerId: string
): Promise<DockerInspect | null> {
  const fmt = [
    '{{.Id}}',
    '{{.Created}}',
    '{{.State.StartedAt}}',
    '{{.State.FinishedAt}}',
    '{{.Config.Image}}',
    '{{json .Config.Cmd}}',
    '{{.HostConfig.RestartPolicy.Name}}',
    '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}',
    '{{range .Mounts}}{{.Source}} -> {{.Destination}} ({{.Type}}); {{end}}',
    '{{.Platform}}',
    '{{.SizeRw}}',
    '{{.SizeRootFs}}'
  ].join('\t')

  const result = await dockerExec(
    session,
    `inspect --size --format '${fmt}' ${JSON.stringify(containerId)}`
  )
  if (result.code !== 0) return null

  const cols = (result.stdout.trim().split('\t') || []).map((c) => c.trim())
  let command = cols[5] || ''
  try {
    const parsed = JSON.parse(command) as string[] | null
    if (Array.isArray(parsed)) command = parsed.join(' ')
  } catch {
    /* keep raw */
  }

  const formatBytes = (raw: string): string => {
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) return raw || '—'
    if (n < 1024) return `${n} B`
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
    return `${(n / 1024 ** 3).toFixed(2)} GB`
  }

  return {
    id: cols[0] || containerId,
    created: cols[1] || '',
    startedAt: cols[2] || '',
    finishedAt: cols[3] || '',
    image: cols[4] || '',
    command,
    restartPolicy: cols[6] || 'no',
    networks: (cols[7] || '').trim() || '—',
    mounts: (cols[8] || '').replace(/;\s*$/, '').trim() || '—',
    platform: cols[9] || '—',
    sizeRw: formatBytes(cols[10] || ''),
    sizeRootFs: formatBytes(cols[11] || '')
  }
}

export async function containerAction(
  session: SshSession,
  containerId: string,
  action: 'start' | 'stop' | 'restart' | 'remove'
): Promise<{ ok: boolean; output: string }> {
  const args =
    action === 'remove'
      ? `rm -f ${JSON.stringify(containerId)}`
      : `${action} ${JSON.stringify(containerId)}`
  const result = await dockerExec(session, args)
  return {
    ok: result.code === 0,
    output: (result.stdout || result.stderr).trim()
  }
}
