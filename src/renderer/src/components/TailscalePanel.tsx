import { useCallback, useEffect, useMemo, useState } from 'react'
import type { OpResult, TailscalePrefs, TailscaleStatus } from '../types'
import { errorMessage, relativeTime } from '../lib/format'
import { Icon, Spinner, Switch, useDialog, useToast } from './ui'

interface Props {
  serverId: string
  active: boolean
}

interface PeerJson {
  HostName?: string
  DNSName?: string
  OS?: string
  TailscaleIPs?: string[]
  Online?: boolean
  ExitNode?: boolean
  ExitNodeOption?: boolean
  LastSeen?: string
  CurAddr?: string
  Relay?: string
}

interface StatusJson {
  BackendState?: string
  Self?: PeerJson
  Peer?: Record<string, PeerJson>
  CurrentTailnet?: { Name?: string }
  MagicDNSSuffix?: string
}

type SettingKey = 'accept-routes' | 'accept-dns' | 'ssh' | 'advertise-exit-node'

const SETTINGS: { key: SettingKey; pref: keyof TailscalePrefs; label: string; hint: string }[] = [
  {
    key: 'accept-routes',
    pref: 'acceptRoutes',
    label: 'Accept routes',
    hint: 'Use subnet routes advertised by other nodes'
  },
  {
    key: 'accept-dns',
    pref: 'acceptDns',
    label: 'Accept DNS',
    hint: 'Use MagicDNS and tailnet DNS settings'
  },
  { key: 'ssh', pref: 'ssh', label: 'Tailscale SSH', hint: 'Allow SSH via Tailscale identity' },
  {
    key: 'advertise-exit-node',
    pref: 'exitNode',
    label: 'Exit node',
    hint: 'Offer this machine as an exit node'
  }
]

function parseStatus(raw: string | null): StatusJson | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as StatusJson
  } catch {
    return null
  }
}

export default function TailscalePanel({ serverId, active }: Props) {
  const [status, setStatus] = useState<TailscaleStatus | null>(null)
  const [authKey, setAuthKey] = useState('')
  const [output, setOutput] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const toast = useToast()
  const dialog = useDialog()

  const refresh = useCallback(async () => {
    setBusy((b) => b || 'refresh')
    try {
      const s = await window.api.tailscale.status(serverId)
      setStatus(s)
      setError(s.error || null)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoaded(true)
      setBusy((b) => (b === 'refresh' ? null : b))
    }
  }, [serverId])

  useEffect(() => {
    if (active) void refresh()
  }, [refresh, active])

  const json = useMemo(() => parseStatus(status?.statusJson ?? null), [status])
  const peers = useMemo(
    () =>
      Object.values(json?.Peer || {}).sort((a, b) => {
        if (a.Online !== b.Online) return a.Online ? -1 : 1
        return (a.HostName || '').localeCompare(b.HostName || '')
      }),
    [json]
  )

  const run = async (label: string, fn: () => Promise<OpResult>, success: string) => {
    setBusy(label)
    try {
      const result = await fn()
      setOutput(result.output)
      if (result.ok) toast({ kind: 'success', title: success })
      else toast({ kind: 'error', title: `${label} failed`, detail: result.output })
    } catch (e) {
      toast({ kind: 'error', title: `${label} failed`, detail: errorMessage(e) })
    } finally {
      setBusy(null)
      await refresh()
    }
  }

  const down = async () => {
    const ok = await dialog.confirm({
      title: 'Disconnect Tailscale?',
      message:
        'If you are reaching this host through Tailscale, this SSH session will drop and you will need another way in to bring it back up.',
      confirmLabel: 'Bring down',
      danger: true
    })
    if (ok) void run('Down', () => window.api.tailscale.down(serverId), 'Tailscale is down')
  }

  if (!loaded) {
    return (
      <div className="panel">
        <div className="empty">
          <Spinner size={22} />
          <p>Checking Tailscale…</p>
        </div>
      </div>
    )
  }

  if (status && !status.installed) {
    return (
      <div className="panel">
        <div className="empty">
          <Icon name="network" size={32} />
          <h2>Tailscale is not installed</h2>
          <p>Install it with the official script (requires sudo and internet access on the host).</p>
          <button
            className="btn primary"
            type="button"
            disabled={!!busy}
            onClick={() =>
              void run('Install', () => window.api.tailscale.install(serverId), 'Tailscale installed')
            }
          >
            {busy === 'Install' ? <Spinner /> : <Icon name="download" size={14} />}
            {busy === 'Install' ? 'Installing…' : 'Install Tailscale'}
          </button>
          {output && <pre className="pre" style={{ marginTop: '1rem', textAlign: 'left' }}>{output}</pre>}
        </div>
      </div>
    )
  }

  const backend = json?.BackendState || 'Unknown'
  const running = backend === 'Running'

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <strong>Tailscale</strong>
        <span className={`status-pill ${running ? 'running' : 'exited'}`}>{backend}</span>
        <span className="spacer" />
        <button
          className="btn"
          type="button"
          disabled={!!busy}
          onClick={() => void run('Update', () => window.api.tailscale.update(serverId), 'Tailscale updated')}
        >
          {busy === 'Update' ? <Spinner /> : <Icon name="download" size={14} />}
          Update
        </button>
        <button className="btn" type="button" disabled={!!busy} onClick={() => void refresh()}>
          {busy === 'refresh' ? <Spinner /> : <Icon name="refresh" size={14} />}
          Refresh
        </button>
      </div>

      {error && (
        <div className="error-banner">
          <Icon name="alert" size={14} />
          <span>{error}</span>
        </div>
      )}

      <div className="grid-cards">
        <div className="stat-card">
          <div className="label">This node</div>
          <div className="value">{json?.Self?.HostName || '—'}</div>
          <div className="stat-sub mono">{json?.Self?.TailscaleIPs?.join(', ') || 'no IP'}</div>
        </div>
        <div className="stat-card">
          <div className="label">Tailnet</div>
          <div className="value small-value">{json?.CurrentTailnet?.Name || '—'}</div>
          <div className="stat-sub mono">{json?.MagicDNSSuffix || ''}</div>
        </div>
        <div className="stat-card">
          <div className="label">Peers</div>
          <div className="value">
            {peers.filter((p) => p.Online).length}{' '}
            <span className="muted value-total">/ {peers.length} online</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Version</div>
          <div className="value small-value mono">{status?.version || '—'}</div>
        </div>
      </div>

      <div className="ts-grid">
        <div className="card">
          <div className="card-title">Connection</div>
          <div className="field-row">
            <input
              type="password"
              placeholder="Auth key (optional)"
              value={authKey}
              onChange={(e) => setAuthKey(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              className="btn primary"
              type="button"
              disabled={!!busy}
              onClick={() =>
                void run(
                  'Up',
                  () => window.api.tailscale.up(serverId, authKey || undefined),
                  'Tailscale is up'
                )
              }
            >
              {busy === 'Up' ? <Spinner /> : <Icon name="play" size={14} />}
              Up
            </button>
            <button
              className="btn danger"
              type="button"
              disabled={!!busy || !running}
              onClick={() => void down()}
            >
              {busy === 'Down' ? <Spinner /> : <Icon name="power" size={14} />}
              Down
            </button>
          </div>
          <p className="muted small-text" style={{ marginBottom: 0 }}>
            Without an auth key, <span className="mono">tailscale up</span> prints a login URL in
            the output below.
          </p>
        </div>

        <div className="card">
          <div className="card-title">Settings</div>
          {SETTINGS.map((s) => {
            const value = status?.prefs ? status.prefs[s.pref] : null
            return (
              <div key={s.key} className="setting-row">
                <div>
                  <div>{s.label}</div>
                  <div className="muted small-text">{s.hint}</div>
                </div>
                <Switch
                  label={s.label}
                  checked={value}
                  disabled={!!busy}
                  onChange={(next) =>
                    void run(
                      s.label,
                      () => window.api.tailscale.set(serverId, s.key, next),
                      `${s.label} ${next ? 'enabled' : 'disabled'}`
                    )
                  }
                />
              </div>
            )
          })}
          {!status?.prefs && (
            <p className="muted small-text" style={{ marginBottom: 0 }}>
              Current values unavailable (needs sudo). Toggling still applies the setting.
            </p>
          )}
        </div>
      </div>

      {output && (
        <>
          <h3 className="section-title">Command output</h3>
          <pre className="pre">{output}</pre>
        </>
      )}

      <h3 className="section-title">Peers</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Host</th>
              <th>Address</th>
              <th>OS</th>
              <th>Connection</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {peers.map((p) => (
              <tr key={`${p.HostName}-${p.TailscaleIPs?.[0]}`}>
                <td>
                  <span className={`dot inline ${p.Online ? 'on' : ''}`} /> {p.HostName}
                  {p.ExitNode && <span className="tag">exit node</span>}
                  {!p.ExitNode && p.ExitNodeOption && <span className="tag muted-tag">exit option</span>}
                </td>
                <td className="mono">{p.TailscaleIPs?.[0] || '—'}</td>
                <td>{p.OS || '—'}</td>
                <td className="mono muted">
                  {p.Online ? (p.CurAddr ? 'direct' : p.Relay ? `relay ${p.Relay}` : '—') : 'offline'}
                </td>
                <td className="muted">{p.Online ? 'now' : relativeTime(p.LastSeen || '')}</td>
              </tr>
            ))}
            {peers.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No peers.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <details className="raw-details">
        <summary>Raw status</summary>
        <pre className="pre">{status?.rawStatus || 'No status yet.'}</pre>
      </details>
    </div>
  )
}
