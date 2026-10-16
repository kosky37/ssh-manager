import { useEffect, useState } from 'react'
import type { ServerInfo, TabId } from '../types'
import TerminalPanel from './TerminalPanel'
import DockerPanel from './DockerPanel'
import TailscalePanel from './TailscalePanel'
import ResourcesPanel from './ResourcesPanel'
import FileManagerPanel from './FileManagerPanel'

interface Props {
  server: ServerInfo
  busy: boolean
  error: string | null
  onConnect: (su?: boolean) => Promise<boolean>
  onDisconnect: () => Promise<void>
  onClearError: () => void
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'docker', label: 'Docker' },
  { id: 'tailscale', label: 'Tailscale' },
  { id: 'resources', label: 'Resources' },
  { id: 'files', label: 'Files' }
]

export default function SessionView({
  server,
  busy,
  error,
  onConnect,
  onDisconnect,
  onClearError
}: Props) {
  const [tab, setTab] = useState<TabId>('terminal')
  // Default to root elevation for non-root accounts (password is tried automatically).
  const [wantSu, setWantSu] = useState(server.username !== 'root')
  const [termNonce, setTermNonce] = useState(0)

  useEffect(() => {
    setWantSu(server.username !== 'root')
    setTermNonce(0)
    setTab('terminal')
  }, [server.id, server.username])

  const ensureConnected = async (su = server.username !== 'root') => {
    if (server.connected) return true
    return (await onConnect(su)) === true
  }

  const openWithSu = async () => {
    setWantSu(true)
    const ok = await ensureConnected(true)
    if (ok) {
      setTab('terminal')
      setTermNonce((n) => n + 1)
    }
  }

  const openWithoutSu = async () => {
    setWantSu(false)
    const ok = await ensureConnected(false)
    if (ok) {
      setTab('terminal')
      setTermNonce((n) => n + 1)
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h2>{server.name}</h2>
          <div className="sub">
            {server.username}@{server.host}
          </div>
        </div>
        <div className="actions">
          {!server.connected ? (
            <>
              <button
                className="btn primary"
                type="button"
                disabled={busy}
                onClick={openWithSu}
              >
                {server.username === 'root' ? 'Connect' : 'Connect + su'}
              </button>
              {server.username !== 'root' && (
                <button className="btn" type="button" disabled={busy} onClick={openWithoutSu}>
                  Connect as user
                </button>
              )}
            </>
          ) : (
            <button className="btn danger" type="button" disabled={busy} onClick={onDisconnect}>
              Disconnect
            </button>
          )}
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={async () => {
              onClearError()
              if (!server.connected) {
                const elevate = server.username !== 'root'
                setWantSu(elevate)
                const ok = await ensureConnected(elevate)
                if (!ok) return
              }
              setTab(t.id)
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="content">
        {error && <div className="error-banner" style={{ margin: '1rem' }}>{error}</div>}

        {!server.connected ? (
          <div className="empty">
            <h2>Not connected</h2>
            <p>Connect to open a session on this host.</p>
          </div>
        ) : (
          <>
            {tab === 'terminal' && (
              <TerminalPanel
                key={`${server.id}-${termNonce}-${wantSu}`}
                serverId={server.id}
                su={wantSu}
              />
            )}
            {tab === 'docker' && <DockerPanel serverId={server.id} />}
            {tab === 'tailscale' && <TailscalePanel serverId={server.id} />}
            {tab === 'resources' && <ResourcesPanel serverId={server.id} />}
            {tab === 'files' && <FileManagerPanel serverId={server.id} />}
          </>
        )}
      </div>
    </>
  )
}
