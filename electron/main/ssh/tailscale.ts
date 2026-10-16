import type { SshSession } from './session'
import type { TailscaleStatus } from '../types'

export async function getTailscaleStatus(session: SshSession): Promise<TailscaleStatus> {
  const which = await session.exec('command -v tailscale >/dev/null 2>&1 && echo yes || echo no')
  if (which.stdout.trim() !== 'yes') {
    return { installed: false, version: null, statusJson: null, rawStatus: null }
  }

  const version = await session.exec('tailscale version 2>&1 | head -n 1')
  const status = await session.exec('tailscale status 2>&1')
  const statusJson = await session.exec('tailscale status --json 2>&1')

  return {
    installed: true,
    version: version.stdout.trim() || null,
    rawStatus: status.stdout.trim() || status.stderr.trim() || null,
    statusJson:
      statusJson.code === 0 ? statusJson.stdout.trim() : null,
    error: status.code !== 0 ? status.stderr.trim() : undefined
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
  const result = await session.exec(script, 180000)
  return {
    ok: result.code === 0,
    output: (result.stdout || result.stderr).trim()
  }
}

export async function updateTailscale(session: SshSession): Promise<{ ok: boolean; output: string }> {
  const script = `
set -e
if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update -y && sudo apt-get install -y --only-upgrade tailscale
elif command -v yum >/dev/null 2>&1; then
  sudo yum update -y tailscale
elif command -v dnf >/dev/null 2>&1; then
  sudo dnf upgrade -y tailscale
else
  curl -fsSL https://tailscale.com/install.sh | sh
fi
tailscale version | head -n 1
`
  const result = await session.exec(script, 180000)
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
  const result = await session.exec(`sudo tailscale set ${map[setting]} 2>&1`)
  return {
    ok: result.code === 0,
    output: (result.stdout || result.stderr).trim()
  }
}

export async function tailscaleUp(
  session: SshSession,
  authKey?: string
): Promise<{ ok: boolean; output: string }> {
  const keyPart = authKey ? ` --authkey=${JSON.stringify(authKey)}` : ''
  const result = await session.exec(`sudo tailscale up${keyPart} 2>&1`, 120000)
  return {
    ok: result.code === 0,
    output: (result.stdout || result.stderr).trim()
  }
}

export async function tailscaleDown(session: SshSession): Promise<{ ok: boolean; output: string }> {
  const result = await session.exec('sudo tailscale down 2>&1')
  return {
    ok: result.code === 0,
    output: (result.stdout || result.stderr).trim()
  }
}
