import { useCallback, useEffect, useState } from 'react'

interface Resources {
  hostname: string
  uptime: string
  loadAvg: string
  cpuModel: string
  cpuCores: string
  memTotal: string
  memUsed: string
  memAvailable: string
  swapTotal: string
  swapUsed: string
  disk: string
  topProcesses: string
}

interface Props {
  serverId: string
}

export default function ResourcesPanel({ serverId }: Props) {
  const [data, setData] = useState<Resources | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await window.api.system.resources(serverId)
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [serverId])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 15000)
    return () => clearInterval(timer)
  }, [refresh])

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <strong>System resources</strong>
        <span className="spacer" />
        <button className="btn" type="button" disabled={busy} onClick={refresh}>
          Refresh
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {data && (
        <>
          <div className="grid-cards">
            <div className="stat-card">
              <div className="label">Hostname</div>
              <div className="value">{data.hostname}</div>
            </div>
            <div className="stat-card">
              <div className="label">Uptime</div>
              <div className="value" style={{ fontSize: '1rem' }}>
                {data.uptime}
              </div>
            </div>
            <div className="stat-card">
              <div className="label">Load avg</div>
              <div className="value mono">{data.loadAvg}</div>
            </div>
            <div className="stat-card">
              <div className="label">CPU</div>
              <div className="value" style={{ fontSize: '0.95rem' }}>
                {data.cpuCores} cores
              </div>
              <div className="muted" style={{ marginTop: 4, fontSize: '0.8rem' }}>
                {data.cpuModel}
              </div>
            </div>
            <div className="stat-card">
              <div className="label">Memory</div>
              <div className="value">
                {data.memUsed} / {data.memTotal}
              </div>
              <div className="muted" style={{ marginTop: 4, fontSize: '0.8rem' }}>
                available {data.memAvailable}
              </div>
            </div>
            <div className="stat-card">
              <div className="label">Swap</div>
              <div className="value">
                {data.swapUsed} / {data.swapTotal}
              </div>
            </div>
          </div>

          <h3 style={{ margin: '0.25rem 0 0.5rem' }}>Disk</h3>
          <pre className="pre">{data.disk}</pre>

          <h3 style={{ margin: '1rem 0 0.5rem' }}>Top processes</h3>
          <pre className="pre">{data.topProcesses}</pre>
        </>
      )}
    </div>
  )
}
