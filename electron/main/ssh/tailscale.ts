import type { SshSession } from './session'
import type { TailscalePrefs, TailscaleStatus } from '../types'
import { shellQuote, sudoExec } from './elevate'

function parsePrefs(text: string): TailscalePrefs | null {
  try {
    const start = text.indexOf('{')
    if (start < 0) return null
    const prefs = JSON.parse(text.slice(start)) as {
      RouteAll?: boolean
      CorpDNS?: boolean
      RunSSH?: boolean
      AdvertiseRoutes?: string[] | null
    }
    const routes = prefs.AdvertiseRoutes || []
    return {
      acceptRoutes: prefs.RouteAll ?? null,
      acceptDns: prefs.CorpDNS ?? null,
      ssh: prefs.RunSSH ?? null,
      exitNode: routes.includes('0.0.0.0/0') || routes.includes('::/0')
    }
  } catch {
    return null
  }
}

export async function getTailscaleStatus(session: SshSession): Promise<TailscaleStatus> {
  const which = await session.exec('command -v tailscale >/dev/null 2>&1 && echo yes || echo no')
  if (which.stdout.trim() !== 'yes') {
    return { installed: false, version: null, statusJson: null, rawStatus: null, prefs: null }
  }

  const [version, status, statusJson, prefs] = await Promise.all([
    session.exec('tailscale version 2>&1 | head -n 1'),
    session.exec('tailscale status 2>&1'),
    session.exec('tailscale status --json 2>/dev/null'),
    sudoExec(session, 'tailscale debug prefs 2>/dev/null')
  ])

  return {
    installed: true,
    version: version.stdout.trim() || null,
    rawStatus: status.stdout.trim() || status.stderr.trim() || null,
    statusJson: statusJson.code === 0 ? statusJson.stdout.trim() : null,
    prefs: prefs.code === 0 ? parsePrefs(prefs.stdout) : null,
    error: status.code !== 0 ? status.stderr.trim() || undefined : undefined
  }
}

export async function installTailscale(session: SshSession): Promise<{ ok: boolean; output: string }> {
  const script = `
set -e
if command -v tailscale >/dev/null 2>&1; then
  echo "Tailscale already installed"
  tailscale version | head -n 1
  exit 0
fi
if command -v curl >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
elif command -v wget >/dev/null 2>&1; then
  wget -qO- https://tailscale.com/install.sh | sh
else
  echo "Neither curl nor wget available" >&2
  exit 1
fi
tailscale version | head -n 1
`
  const result = await sudoExec(session, `sh -c ${shellQuote(script)} 2>&1`, 300000)
  return {
    ok: result.code === 0,
    output: (result.stdout || result.stderr).trim()
  }
}

export async function updateTailscale(session: SshSession): Promise<{ ok: boolean; output: string }> {
  const script = `
set -e
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -y && apt-get install -y --only-upgrade tailscale
elif command -v dnf >/dev/null 2>&1; then
  dnf upgrade -y tailscale
elif command -v yum >/dev/null 2>&1; then
  yum update -y tailscale
else
  tailscale update --yes
fi
tailscale version | head -n 1
`
  const result = await sudoExec(session, `sh -c ${shellQuote(script)} 2>&1`, 300000)
  return {
    ok: result.code === 0,
    output: (result.stdout || result.stderr).trim()
  }
}

export async function setTailscaleSetting(
  session: SshSession,
  setting: 'accept-routes' | 'accept-dns' | 'ssh' | 'advertise-exit-node',
  enabled: boolean
): Promise<{ ok: boolean; output: string }> {
  const flag = enabled ? 'true' : 'false'
  const map: Record<string, string> = {
    'accept-routes': `--accept-routes=${flag}`,
    'accept-dns': `--accept-dns=${flag}`,
    ssh: `--ssh=${flag}`,
    'advertise-exit-node': `--advertise-exit-node=${flag}`
  }
  const result = await sudoExec(session, `tailscale set ${map[setting]} 2>&1`)
  return {
    ok: result.code === 0,
    output: (result.stdout || result.stderr).trim()
  }
}

export async function tailscaleUp(
  session: SshSession,
  authKey?: string
): Promise<{ ok: boolean; output: string }> {
  const keyPart = authKey ? ` --authkey=${shellQuote(authKey)}` : ''
  const result = await sudoExec(session, `tailscale up${keyPart} --timeout=60s 2>&1`, 120000)
  return {
    ok: result.code === 0,
    output: (result.stdout || result.stderr).trim()
  }
}

export async function tailscaleDown(session: SshSession): Promise<{ ok: boolean; output: string }> {
  const result = await sudoExec(session, 'tailscale down 2>&1')
  return {
    ok: result.code === 0,
    output: (result.stdout || result.stderr).trim()
  }
}
