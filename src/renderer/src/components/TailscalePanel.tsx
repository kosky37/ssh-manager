import { useCallback, useEffect, useState } from 'react'

interface Status {
  installed: boolean
  version: string | null
  statusJson: string | null
  rawStatus: string | null
  error?: string
}

interface Props {
  serverId: string
}

export default function TailscalePanel({ serverId }: Props) {
  const [status, setStatus] = useState<Status | null>(null)
  const [authKey, setAuthKey] = useState('')
  const [output, setOutput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const s = await window.api.tailscale.status(serverId)
      setStatus(s)
      if (s.error) setError(s.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [serverId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const run = async (fn: () => Promise<{ ok: boolean; output: string }>) => {
    setBusy(true)
    setError(null)
    const result = await fn()
    setOutput(result.output)
    if (!result.ok) setError(result.output || 'Command failed')
    await refresh()
  }

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <strong>Tailscale</strong>
        <span className="spacer" />
        <button className="btn" type="button" disabled={busy} onClick={refresh}>
          Refresh
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="grid-cards">
        <div className="stat-card">
          <div className="label">Installed</div>
          <div className="value">{status?.installed ? 'Yes' : 'No'}</div>
        </div>
        <div className="stat-card">
          <div className="label">Version</div>
          <div className="value" style={{ fontSize: '0.95rem' }}>
            {status?.version || '—'}
          </div>
        </div>
      </div>

      <div className="panel-toolbar">
        {!status?.installed ? (
          <button
            className="btn primary"
            type="button"
            disabled={busy}
            onClick={() => run(() => window.api.tailscale.install(serverId))}
          >
            Install Tailscale
          </button>
        ) : (
          <>
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => run(() => window.api.tailscale.update(serverId))}
            >
              Update
            </button>
            <button
              className="btn primary"
              type="button"
              disabled={busy}
              onClick={() =>
                run(() => window.api.tailscale.up(serverId, authKey || undefined))
              }
            >
              Up
            </button>
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => run(() => window.api.tailscale.down(serverId))}
            >
              Down
            </button>
          </>
        )}
      </div>

      {status?.installed && (
        <>
          <div className="field-row" style={{ marginBottom: '0.85rem' }}>
            <input
              type="password"
              placeholder="Auth key (optional for up)"
              value={authKey}
              onChange={(e) => setAuthKey(e.target.value)}
            />
          </div>

          <div className="panel-toolbar">
            <span className="muted">Settings</span>
            {(
              [
                ['accept-routes', 'Accept routes'],
                ['accept-dns', 'Accept DNS'],
                ['ssh', 'Tailscale SSH'],
                ['advertise-exit-node', 'Exit node']
              ] as const
            ).map(([key, label]) => (
              <span key={key} className="row-actions">
                <button
                  className="btn"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(() => window.api.tailscale.set(serverId, key, true))
                  }
                >
                  {label} on
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(() => window.api.tailscale.set(serverId, key, false))
                  }
                >
                  off
                </button>
              </span>
            ))}
          </div>
        </>
      )}

      {output && (
        <>
          <h3 style={{ margin: '0.5rem 0' }}>Command output</h3>
          <pre className="pre">{output}</pre>
        </>
      )}

      <h3 style={{ margin: '1rem 0 0.5rem' }}>Status</h3>
      <pre className="pre">{status?.rawStatus || 'No status yet.'}</pre>
    </div>
  )
}
