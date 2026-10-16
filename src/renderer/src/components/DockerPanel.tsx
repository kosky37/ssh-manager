import { useCallback, useEffect, useMemo, useState } from 'react'

interface Container {
  id: string
  name: string
  image: string
  status: string
  state: string
  ports: string
}

interface Stats {
  id: string
  name: string
  cpu: string
  memUsage: string
  memPerc: string
  netIO: string
  blockIO: string
}

interface Inspect {
  id: string
  created: string
  startedAt: string
  finishedAt: string
  image: string
  command: string
  restartPolicy: string
  networks: string
  mounts: string
  platform: string
  sizeRw: string
  sizeRootFs: string
}

interface Props {
  serverId: string
}

function parsePerc(value?: string): number {
  if (!value) return 0
  const n = Number.parseFloat(value.replace('%', ''))
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

function formatWhen(iso?: string): string {
  if (!iso || iso.startsWith('0001')) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

function BarChart({
  title,
  items,
  accent
}: {
  title: string
  items: { label: string; value: number; detail: string }[]
  accent: string
}) {
  const max = Math.max(100, ...items.map((i) => i.value), 1)

  return (
    <div className="usage-chart">
      <div className="usage-chart-title">{title}</div>
      {items.length === 0 ? (
        <div className="muted" style={{ fontSize: '0.85rem' }}>
          No running containers
        </div>
      ) : (
        <div className="usage-bars">
          {items.map((item) => (
            <div key={item.label} className="usage-bar-row">
              <div className="usage-bar-label" title={item.label}>
                {item.label}
              </div>
              <div className="usage-bar-track">
                <div
                  className="usage-bar-fill"
                  style={{
                    width: `${Math.min(100, (item.value / max) * 100)}%`,
                    background: accent
                  }}
                />
              </div>
              <div className="usage-bar-value mono">{item.detail}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Gauge({
  label,
  percent,
  detail,
  accent
}: {
  label: string
  percent: number
  detail: string
  accent: string
}) {
  const r = 36
  const c = 2 * Math.PI * r
  const clamped = Math.min(100, Math.max(0, percent))
  const offset = c * (1 - clamped / 100)

  return (
    <div className="gauge">
      <svg viewBox="0 0 96 96" className="gauge-ring" aria-hidden>
        <circle cx="48" cy="48" r={r} className="gauge-track" />
        <circle
          cx="48"
          cy="48"
          r={r}
          className="gauge-progress"
          stroke={accent}
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="gauge-center">
        <div className="gauge-pct mono">{clamped.toFixed(1)}%</div>
        <div className="gauge-label">{label}</div>
      </div>
      <div className="gauge-detail muted mono">{detail}</div>
    </div>
  )
}

export default function DockerPanel({ serverId }: Props) {
  const [available, setAvailable] = useState(true)
  const [containers, setContainers] = useState<Container[]>([])
  const [stats, setStats] = useState<Stats[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [inspect, setInspect] = useState<Inspect | null>(null)
  const [logs, setLogs] = useState('')
  const [showLogs, setShowLogs] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [logsBusy, setLogsBusy] = useState(false)

  const statsFor = useCallback(
    (id: string) => stats.find((s) => id.startsWith(s.id) || s.id.startsWith(id)),
    [stats]
  )

  const selectedContainer = useMemo(
    () => containers.find((c) => c.id === selected) || null,
    [containers, selected]
  )

  const selectedStats = selected ? statsFor(selected) : undefined

  const refresh = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) {
      setBusy(true)
      setError(null)
    }
    try {
      const list = await window.api.docker.list(serverId)
      setAvailable(list.available)
      setContainers(list.containers)
      if (list.error && !opts?.quiet) setError(list.error)
      if (list.available) {
        const s = await window.api.docker.stats(serverId)
        setStats(s)
      }
    } catch (e) {
      if (!opts?.quiet) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!opts?.quiet) setBusy(false)
    }
  }, [serverId])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => {
      void refresh({ quiet: true })
    }, 10000)
    return () => clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    if (selected && containers.length > 0 && !containers.some((c) => c.id === selected)) {
      setSelected(null)
      setInspect(null)
      setShowLogs(false)
      setLogs('')
    }
  }, [containers, selected])

  useEffect(() => {
    if (!selected) {
      setInspect(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const info = (await window.api.docker.inspect(serverId, selected)) as Inspect | null
        if (!cancelled) setInspect(info)
      } catch {
        if (!cancelled) setInspect(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [serverId, selected])

  const runAction = async (id: string, action: 'start' | 'stop' | 'restart' | 'remove') => {
    setBusy(true)
    const result = await window.api.docker.action(serverId, id, action)
    if (!result.ok) setError(result.output || 'Action failed')
    if (action === 'remove' && selected === id) {
      setSelected(null)
      setShowLogs(false)
      setLogs('')
    }
    await refresh()
  }

  const selectContainer = (id: string) => {
    setSelected(id)
    setShowLogs(false)
    setLogs('')
  }

  const viewLogs = async () => {
    if (!selected) return
    setShowLogs(true)
    setLogsBusy(true)
    try {
      const text = await window.api.docker.logs(serverId, selected, 300)
      setLogs(text)
    } finally {
      setLogsBusy(false)
    }
  }

  const chartItems = useMemo(() => {
    return containers
      .map((c) => {
        const s = statsFor(c.id)
        return {
          label: c.name,
          cpu: parsePerc(s?.cpu),
          cpuLabel: s?.cpu || '—',
          mem: parsePerc(s?.memPerc),
          memLabel: s ? `${s.memPerc}` : '—',
          running: c.state === 'running'
        }
      })
      .filter((c) => c.running)
      .sort((a, b) => b.cpu - a.cpu)
  }, [containers, statsFor])

  if (!available) {
    return (
      <div className="panel">
        <div className="empty">
          <h2>Docker not found</h2>
          <p>This host does not appear to have the Docker CLI installed.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="panel docker-panel">
      <div className="panel-toolbar">
        <strong>Containers</strong>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {containers.length} total · {containers.filter((c) => c.state === 'running').length} running
        </span>
        <span className="spacer" />
        <button className="btn" type="button" disabled={busy} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="usage-charts">
        <BarChart
          title="CPU usage"
          accent="var(--accent)"
          items={chartItems.map((c) => ({
            label: c.label,
            value: c.cpu,
            detail: c.cpuLabel
          }))}
        />
        <BarChart
          title="Memory usage"
          accent="var(--warn)"
          items={chartItems.map((c) => ({
            label: c.label,
            value: c.mem,
            detail: c.memLabel
          }))}
        />
      </div>

      <div className={`split docker-split${selected ? ' has-detail' : ''}`}>
        <div className="table-wrap">
          <table className="docker-list">
            <thead>
              <tr>
                <th>Name</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {containers.map((c) => (
                <tr
                  key={c.id}
                  className={selected === c.id ? 'selected' : undefined}
                  onClick={() => selectContainer(c.id)}
                >
                  <td>
                    <div className="docker-name">{c.name}</div>
                  </td>
                  <td>
                    <span className={`status-pill ${c.state}`}>{c.state}</span>
                  </td>
                </tr>
              ))}
              {containers.length === 0 && (
                <tr>
                  <td colSpan={2} className="muted">
                    No containers found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {selectedContainer && (
          <div className="docker-detail">
            <div className="panel-toolbar" style={{ marginBottom: '0.65rem' }}>
              <div>
                <strong>{selectedContainer.name}</strong>
                <div className="muted mono" style={{ fontSize: '0.75rem', marginTop: 2 }}>
                  {selectedContainer.id.slice(0, 12)}
                </div>
              </div>
              <span className="spacer" />
              <span className={`status-pill ${selectedContainer.state}`}>
                {selectedContainer.state}
              </span>
            </div>

            <div className="row-actions" style={{ marginBottom: '0.85rem' }}>
              {selectedContainer.state === 'running' ? (
                <>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => runAction(selectedContainer.id, 'stop')}
                  >
                    Stop
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => runAction(selectedContainer.id, 'restart')}
                  >
                    Restart
                  </button>
                </>
              ) : (
                <button
                  className="btn"
                  type="button"
                  onClick={() => runAction(selectedContainer.id, 'start')}
                >
                  Start
                </button>
              )}
              <button
                className="btn danger"
                type="button"
                onClick={() => runAction(selectedContainer.id, 'remove')}
              >
                Remove
              </button>
              <button
                className="btn"
                type="button"
                disabled={logsBusy}
                onClick={() => (showLogs ? setShowLogs(false) : viewLogs())}
              >
                {showLogs ? 'Hide logs' : 'Logs'}
              </button>
            </div>

            {selectedStats && (
              <div className="gauge-row">
                <Gauge
                  label="CPU"
                  percent={parsePerc(selectedStats.cpu)}
                  detail={selectedStats.cpu}
                  accent="var(--accent)"
                />
                <Gauge
                  label="Memory"
                  percent={parsePerc(selectedStats.memPerc)}
                  detail={`${selectedStats.memUsage} (${selectedStats.memPerc})`}
                  accent="var(--warn)"
                />
              </div>
            )}

            <div className="detail-grid">
              <div className="detail-item">
                <div className="label">Image</div>
                <div className="mono">{inspect?.image || selectedContainer.image}</div>
              </div>
              <div className="detail-item">
                <div className="label">Status</div>
                <div>{selectedContainer.status}</div>
              </div>
              <div className="detail-item">
                <div className="label">Ports</div>
                <div className="mono">{selectedContainer.ports || '—'}</div>
              </div>
              <div className="detail-item">
                <div className="label">Networks</div>
                <div className="mono">{inspect?.networks || '—'}</div>
              </div>
              <div className="detail-item">
                <div className="label">Command</div>
                <div className="mono">{inspect?.command || '—'}</div>
              </div>
              <div className="detail-item">
                <div className="label">Restart policy</div>
                <div>{inspect?.restartPolicy || '—'}</div>
              </div>
              <div className="detail-item">
                <div className="label">Created</div>
                <div>{formatWhen(inspect?.created)}</div>
              </div>
              <div className="detail-item">
                <div className="label">Started</div>
                <div>{formatWhen(inspect?.startedAt)}</div>
              </div>
              <div className="detail-item">
                <div className="label">Net I/O</div>
                <div className="mono">{selectedStats?.netIO || '—'}</div>
              </div>
              <div className="detail-item">
                <div className="label">Block I/O</div>
                <div className="mono">{selectedStats?.blockIO || '—'}</div>
              </div>
              <div className="detail-item">
                <div className="label">Writable layer</div>
                <div className="mono">{inspect?.sizeRw || '—'}</div>
              </div>
              <div className="detail-item">
                <div className="label">Root filesystem</div>
                <div className="mono">{inspect?.sizeRootFs || '—'}</div>
              </div>
              <div className="detail-item detail-item-wide">
                <div className="label">Mounts</div>
                <div className="mono">{inspect?.mounts || '—'}</div>
              </div>
            </div>

            {showLogs && (
              <div className="docker-logs">
                <div className="panel-toolbar" style={{ marginBottom: '0.5rem' }}>
                  <strong>Logs</strong>
                  <span className="spacer" />
                  <button className="btn" type="button" disabled={logsBusy} onClick={viewLogs}>
                    Reload
                  </button>
                </div>
                <pre className="pre logs">{logsBusy ? 'Loading…' : logs || 'No log output.'}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
