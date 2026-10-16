import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DockerContainer as Container,
  DockerInspect as Inspect,
  DockerStats as Stats,
  OpenTerminal
} from '../types'
import { errorMessage } from '../lib/format'
import { Icon, Spinner, useDialog, useToast } from './ui'

interface Props {
  serverId: string
  host: string
  active: boolean
  onOpenTerminal: OpenTerminal
}

type Action = 'start' | 'stop' | 'restart' | 'remove'

function hostPorts(ports: string): number[] {
  const found = new Set<number>()
  for (const m of ports.matchAll(/:(\d+)->\d+\/tcp/g)) found.add(Number(m[1]))
  return [...found].sort((a, b) => a - b)
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

export default function DockerPanel({ serverId, host, active, onOpenTerminal }: Props) {
  const [available, setAvailable] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [containers, setContainers] = useState<Container[]>([])
  const [stats, setStats] = useState<Stats[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [inspect, setInspect] = useState<Inspect | null>(null)
  const [logs, setLogs] = useState('')
  const [showLogs, setShowLogs] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ id: string; action: Action } | null>(null)
  const [logsBusy, setLogsBusy] = useState(false)
  const [filter, setFilter] = useState('')
  const [runningOnly, setRunningOnly] = useState(false)
  const logsRef = useRef<HTMLPreElement>(null)
  const loadedRef = useRef(false)
  const toast = useToast()
  const dialog = useDialog()

  const statsFor = useCallback(
    (id: string) => stats.find((s) => id.startsWith(s.id) || s.id.startsWith(id)),
    [stats]
  )

  const selectedContainer = useMemo(
    () => containers.find((c) => c.id === selected) || null,
    [containers, selected]
  )

  const selectedStats = selected ? statsFor(selected) : undefined

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return containers
      .filter((c) => !runningOnly || c.state === 'running')
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.image.toLowerCase().includes(q))
      .sort((a, b) => {
        if (a.state === 'running' && b.state !== 'running') return -1
        if (a.state !== 'running' && b.state === 'running') return 1
        return a.name.localeCompare(b.name)
      })
  }, [containers, filter, runningOnly])

  const refresh = useCallback(
    async (opts?: { quiet?: boolean }) => {
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
        if (!opts?.quiet) setError(errorMessage(e))
      } finally {
        loadedRef.current = true
        setLoaded(true)
        if (!opts?.quiet) setBusy(false)
      }
    },
    [serverId]
  )

  useEffect(() => {
    if (!active) return
    void refresh({ quiet: loadedRef.current })
    const timer = setInterval(() => {
      void refresh({ quiet: true })
    }, 10000)
    return () => clearInterval(timer)
  }, [refresh, active])

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
        const info = await window.api.docker.inspect(serverId, selected)
        if (!cancelled) setInspect(info)
      } catch {
        if (!cancelled) setInspect(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [serverId, selected])

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight
  }, [logs])

  const runAction = async (container: Container, action: Action) => {
    if (action === 'remove') {
      const ok = await dialog.confirm({
        title: `Remove ${container.name}?`,
        message: 'The container will be force-removed. Volumes and images are kept.',
        confirmLabel: 'Remove',
        danger: true
      })
      if (!ok) return
    }
    setPending({ id: container.id, action })
    try {
      const result = await window.api.docker.action(serverId, container.id, action)
      if (!result.ok) {
        toast({ kind: 'error', title: `Failed to ${action} ${container.name}`, detail: result.output })
      } else {
        const past = { start: 'Started', stop: 'Stopped', restart: 'Restarted', remove: 'Removed' }
        toast({ kind: 'success', title: `${past[action]} ${container.name}` })
      }
      if (action === 'remove' && selected === container.id) {
        setSelected(null)
        setShowLogs(false)
        setLogs('')
      }
    } catch (e) {
      toast({ kind: 'error', title: `Failed to ${action} ${container.name}`, detail: errorMessage(e) })
    } finally {
      setPending(null)
      await refresh({ quiet: true })
    }
  }

  const selectContainer = (id: string) => {
    setSelected((current) => (current === id ? null : id))
    setShowLogs(false)
    setLogs('')
  }

  const viewLogs = async () => {
    if (!selected) return
    setShowLogs(true)
    setLogsBusy(true)
    try {
      const text = await window.api.docker.logs(serverId, selected, 500)
      setLogs(text)
    } catch (e) {
      setLogs(errorMessage(e))
    } finally {
      setLogsBusy(false)
    }
  }

  const openShell = (c: Container) => {
    onOpenTerminal({
      title: c.name,
      command: `docker exec -it ${c.name} sh -c 'command -v bash >/dev/null && exec bash || exec sh'`,
      su: true
    })
  }

  const followLogs = (c: Container) => {
    onOpenTerminal({
      title: `logs: ${c.name}`,
      command: `docker logs -f --tail 200 ${c.name}`,
      su: true
    })
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

  if (!loaded) {
    return (
      <div className="panel">
        <div className="empty">
          <Spinner size={22} />
          <p>Loading containers…</p>
        </div>
      </div>
    )
  }

  if (!available) {
    return (
      <div className="panel">
        <div className="empty">
          <Icon name="docker" size={32} />
          <h2>Docker not found</h2>
          <p>This host does not appear to have the Docker CLI installed.</p>
        </div>
      </div>
    )
  }

  const isPending = (id: string, action?: Action) =>
    pending?.id === id && (!action || pending.action === action)

  const ports = selectedContainer ? hostPorts(selectedContainer.ports) : []

  return (
    <div className="panel docker-panel">
      <div className="panel-toolbar">
        <strong>Containers</strong>
        <span className="muted small-text">
          {containers.length} total · {containers.filter((c) => c.state === 'running').length}{' '}
          running
        </span>
        <span className="spacer" />
        <div className="search-box compact">
          <Icon name="search" size={14} />
          <input
            type="text"
            placeholder="Filter containers"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <label className="check inline">
          <input
            type="checkbox"
            checked={runningOnly}
            onChange={(e) => setRunningOnly(e.target.checked)}
          />
          <span>Running only</span>
        </label>
        <button className="btn" type="button" disabled={busy} onClick={() => void refresh()}>
          {busy ? <Spinner /> : <Icon name="refresh" size={14} />}
          Refresh
        </button>
      </div>

      {error && (
        <div className="error-banner">
          <Icon name="alert" size={14} />
          <span>{error}</span>
        </div>
      )}

      <div className="usage-charts">
        <BarChart
          title="CPU usage"
          accent="var(--accent)"
          items={chartItems.map((c) => ({ label: c.label, value: c.cpu, detail: c.cpuLabel }))}
        />
        <BarChart
          title="Memory usage"
          accent="var(--warn)"
          items={chartItems.map((c) => ({ label: c.label, value: c.mem, detail: c.memLabel }))}
        />
      </div>

      <div className={`split docker-split${selected ? ' has-detail' : ''}`}>
        <div className="table-wrap">
          <table className="docker-list">
            <thead>
              <tr>
                <th>Name</th>
                <th>State</th>
                <th className="actions-col" />
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr
                  key={c.id}
                  className={selected === c.id ? 'selected' : undefined}
                  onClick={() => selectContainer(c.id)}
                >
                  <td>
                    <div className="docker-name">{c.name}</div>
                    <div className="muted mono docker-image">{c.image}</div>
                  </td>
                  <td>
                    <span className={`status-pill ${c.state}`}>
                      {isPending(c.id) ? <Spinner size={10} /> : null}
                      {c.state}
                    </span>
                  </td>
                  <td className="actions-col" onClick={(e) => e.stopPropagation()}>
                    <div className="row-actions hover-actions">
                      {c.state === 'running' ? (
                        <>
                          <button
                            className="icon-btn"
                            type="button"
                            title="Open shell"
                            onClick={() => openShell(c)}
                          >
                            <Icon name="terminal" size={14} />
                          </button>
                          <button
                            className="icon-btn"
                            type="button"
                            title="Restart"
                            disabled={!!pending}
                            onClick={() => void runAction(c, 'restart')}
                          >
                            <Icon name="restart" size={14} />
                          </button>
                          <button
                            className="icon-btn"
                            type="button"
                            title="Stop"
                            disabled={!!pending}
                            onClick={() => void runAction(c, 'stop')}
                          >
                            <Icon name="stop" size={14} />
                          </button>
                        </>
                      ) : (
                        <button
                          className="icon-btn"
                          type="button"
                          title="Start"
                          disabled={!!pending}
                          onClick={() => void runAction(c, 'start')}
                        >
                          <Icon name="play" size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    {containers.length === 0
                      ? 'No containers found.'
                      : 'No containers match the filter.'}
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
              <button
                type="button"
                className="icon-btn"
                aria-label="Close details"
                onClick={() => setSelected(null)}
              >
                <Icon name="x" size={14} />
              </button>
            </div>

            <div className="row-actions" style={{ marginBottom: '0.85rem' }}>
              {selectedContainer.state === 'running' ? (
                <>
                  <button className="btn" type="button" onClick={() => openShell(selectedContainer)}>
                    <Icon name="terminal" size={14} /> Shell
                  </button>
                  <button
                    className="btn"
                    type="button"
                    disabled={!!pending}
                    onClick={() => void runAction(selectedContainer, 'stop')}
                  >
                    {isPending(selectedContainer.id, 'stop') ? (
                      <Spinner />
                    ) : (
                      <Icon name="stop" size={14} />
                    )}
                    Stop
                  </button>
                  <button
                    className="btn"
                    type="button"
                    disabled={!!pending}
                    onClick={() => void runAction(selectedContainer, 'restart')}
                  >
                    {isPending(selectedContainer.id, 'restart') ? (
                      <Spinner />
                    ) : (
                      <Icon name="restart" size={14} />
                    )}
                    Restart
                  </button>
                </>
              ) : (
                <button
                  className="btn primary"
                  type="button"
                  disabled={!!pending}
                  onClick={() => void runAction(selectedContainer, 'start')}
                >
                  {isPending(selectedContainer.id, 'start') ? (
                    <Spinner />
                  ) : (
                    <Icon name="play" size={14} />
                  )}
                  Start
                </button>
              )}
              <button
                className="btn"
                type="button"
                disabled={logsBusy}
                onClick={() => (showLogs ? setShowLogs(false) : void viewLogs())}
              >
                <Icon name="logs" size={14} />
                {showLogs ? 'Hide logs' : 'Logs'}
              </button>
              <button className="btn" type="button" onClick={() => followLogs(selectedContainer)}>
                <Icon name="terminal" size={14} /> Follow logs
              </button>
              <button
                className="btn danger"
                type="button"
                disabled={!!pending}
                onClick={() => void runAction(selectedContainer, 'remove')}
              >
                <Icon name="trash" size={14} /> Remove
              </button>
            </div>

            {showLogs && (
              <div className="docker-logs">
                <div className="panel-toolbar" style={{ marginBottom: '0.5rem' }}>
                  <strong>Logs</strong>
                  <span className="muted small-text">last 500 lines</span>
                  <span className="spacer" />
                  <button
                    className="btn small"
                    type="button"
                    disabled={!logs}
                    onClick={() => {
                      window.api.clipboard.writeText(logs)
                      toast({ kind: 'success', title: 'Logs copied' })
                    }}
                  >
                    <Icon name="copy" size={12} /> Copy
                  </button>
                  <button
                    className="btn small"
                    type="button"
                    disabled={logsBusy}
                    onClick={() => void viewLogs()}
                  >
                    <Icon name="refresh" size={12} /> Reload
                  </button>
                </div>
                <pre className="pre logs" ref={logsRef}>
                  {logsBusy && !logs ? 'Loading…' : logs || 'No log output.'}
                </pre>
              </div>
            )}

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
                <div className="mono">
                  {ports.length > 0 ? (
                    <div className="port-links">
                      {ports.map((port) => (
                        <a
                          key={port}
                          href={`http://${host}:${port}`}
                          target="_blank"
                          rel="noreferrer"
                          title={`Open http://${host}:${port}`}
                        >
                          {port} <Icon name="external" size={11} />
                        </a>
                      ))}
                    </div>
                  ) : (
                    selectedContainer.ports || '—'
                  )}
                </div>
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
          </div>
        )}
      </div>
    </div>
  )
}
