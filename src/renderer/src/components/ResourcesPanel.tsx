import { useCallback, useEffect, useRef, useState } from 'react'
import type { SystemResources } from '../types'
import { errorMessage, formatBytes, percent } from '../lib/format'
import { load, save } from '../lib/storage'
import { Icon, Meter, Spinner } from './ui'

interface Props {
  serverId: string
  active: boolean
}

const INTERVALS = [
  { label: 'Off', value: 0 },
  { label: '5s', value: 5000 },
  { label: '15s', value: 15000 },
  { label: '60s', value: 60000 }
]

export default function ResourcesPanel({ serverId, active }: Props) {
  const [data, setData] = useState<SystemResources | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [interval, setIntervalMs] = useState<number>(() => load('resources:interval', 5000))
  const [updated, setUpdated] = useState<Date | null>(null)
  const inFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      const res = await window.api.system.resources(serverId)
      setData(res)
      setError(null)
      setUpdated(new Date())
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }, [serverId])

  useEffect(() => {
    if (!active) return
    void refresh()
    if (!interval) return
    const timer = setInterval(() => void refresh(), interval)
    return () => clearInterval(timer)
  }, [refresh, active, interval])

  const memPct = data ? percent(data.memUsed, data.memTotal) : 0
  const swapPct = data ? percent(data.swapUsed, data.swapTotal) : 0
  const loadPct =
    data && data.cpuCores && data.loadAvg[0] !== undefined
      ? percent(data.loadAvg[0], data.cpuCores)
      : 0

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <strong>System resources</strong>
        {updated && (
          <span className="muted small-text">updated {updated.toLocaleTimeString()}</span>
        )}
        <span className="spacer" />
        <span className="muted small-text">Auto-refresh</span>
        <div className="segmented small">
          {INTERVALS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={interval === opt.value ? 'active' : ''}
              onClick={() => {
                setIntervalMs(opt.value)
                save('resources:interval', opt.value)
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
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

      {!data && !error && (
        <div className="empty">
          <Spinner size={22} />
          <p>Collecting system info…</p>
        </div>
      )}

      {data && (
        <>
          <div className="host-line">
            <span className="host-name">{data.hostname}</span>
            {data.os && <span className="muted">{data.os}</span>}
            {data.kernel && <span className="muted mono">{data.kernel}</span>}
            {data.uptime && <span className="muted">up {data.uptime}</span>}
          </div>

          <div className="grid-cards">
            <div className="stat-card">
              <div className="label">CPU</div>
              <div className="value">
                {data.cpuUsage !== null ? `${data.cpuUsage.toFixed(1)}%` : '—'}
              </div>
              <Meter value={data.cpuUsage ?? 0} />
              <div className="stat-sub" title={data.cpuModel}>
                {data.cpuCores} cores · {data.cpuModel || 'unknown model'}
              </div>
            </div>
            <div className="stat-card">
              <div className="label">Load average</div>
              <div className="value mono">
                {data.loadAvg.map((n) => n.toFixed(2)).join('  ') || '—'}
              </div>
              <Meter value={loadPct} />
              <div className="stat-sub">1 · 5 · 15 min, relative to {data.cpuCores} cores</div>
            </div>
            <div className="stat-card">
              <div className="label">Memory</div>
              <div className="value">
                {formatBytes(data.memUsed)}{' '}
                <span className="muted value-total">/ {formatBytes(data.memTotal)}</span>
              </div>
              <Meter value={memPct} />
              <div className="stat-sub">
                {memPct.toFixed(0)}% used · {formatBytes(data.memAvailable)} available
              </div>
            </div>
            <div className="stat-card">
              <div className="label">Swap</div>
              <div className="value">
                {data.swapTotal ? (
                  <>
                    {formatBytes(data.swapUsed)}{' '}
                    <span className="muted value-total">/ {formatBytes(data.swapTotal)}</span>
                  </>
                ) : (
                  'None'
                )}
              </div>
              <Meter value={swapPct} />
              <div className="stat-sub">
                {data.swapTotal ? `${swapPct.toFixed(0)}% used` : 'No swap configured'}
              </div>
            </div>
          </div>

          <h3 className="section-title">Disks</h3>
          <div className="table-wrap" style={{ marginBottom: '1rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Mount</th>
                  <th>Filesystem</th>
                  <th style={{ width: '35%' }}>Usage</th>
                  <th className="num">Used</th>
                  <th className="num">Free</th>
                  <th className="num">Size</th>
                </tr>
              </thead>
              <tbody>
                {data.disks.map((d) => {
                  const pct = percent(d.used, d.used + d.available)
                  return (
                    <tr key={d.mount}>
                      <td className="mono">{d.mount}</td>
                      <td className="mono muted">{d.filesystem}</td>
                      <td>
                        <div className="meter-row">
                          <Meter value={pct} />
                          <span className="mono small-text">{pct.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="mono num">{formatBytes(d.used)}</td>
                      <td className="mono num">{formatBytes(d.available)}</td>
                      <td className="mono num">{formatBytes(d.size)}</td>
                    </tr>
                  )
                })}
                {data.disks.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No disks reported.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <h3 className="section-title">Top processes</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>PID</th>
                  <th>User</th>
                  <th className="num">CPU %</th>
                  <th className="num">Mem %</th>
                  <th>Command</th>
                </tr>
              </thead>
              <tbody>
                {data.processes.map((p) => (
                  <tr key={p.pid}>
                    <td className="mono">{p.pid}</td>
                    <td>{p.user}</td>
                    <td className="mono num">{p.cpu.toFixed(1)}</td>
                    <td className="mono num">{p.mem.toFixed(1)}</td>
                    <td className="mono cmd-cell" title={p.command}>
                      {p.command}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
