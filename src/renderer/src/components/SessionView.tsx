import { useCallback, useEffect, useRef, useState } from 'react'
import type { OpenTerminal, ServerInfo, TabId, TerminalSpec } from '../types'
import { load, save } from '../lib/storage'
import TerminalWorkspace from './TerminalPanel'
import DockerPanel from './DockerPanel'
import TailscalePanel from './TailscalePanel'
import ResourcesPanel from './ResourcesPanel'
import FileManagerPanel from './FileManagerPanel'
import type { ConnState } from './ServerSidebar'
import { Icon, Kbd, Spinner, type IconName } from './ui'

interface Props {
  server: ServerInfo
  active: boolean
  conn: ConnState | undefined
  fontSize: number
  onConnect: () => void
  onDisconnect: () => void
  onEdit: () => void
}

const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'terminal', label: 'Terminal', icon: 'terminal' },
  { id: 'files', label: 'Files', icon: 'folder' },
  { id: 'docker', label: 'Docker', icon: 'docker' },
  { id: 'resources', label: 'Resources', icon: 'activity' },
  { id: 'tailscale', label: 'Tailscale', icon: 'network' }
]

let termCounter = 0

function makeTerminal(spec: Omit<TerminalSpec, 'id'>): TerminalSpec {
  termCounter += 1
  return { ...spec, id: `t${Date.now().toString(36)}${termCounter}` }
}

export default function SessionView({
  server,
  active,
  conn,
  fontSize,
  onConnect,
  onDisconnect,
  onEdit
}: Props) {
  const [tab, setTabState] = useState<TabId>(() => load(`tab:${server.id}`, 'terminal'))
  const [visited, setVisited] = useState<Set<TabId>>(() => new Set([tab]))
  const [terminals, setTerminals] = useState<TerminalSpec[]>([])
  const [activeTermId, setActiveTermId] = useState<string | null>(null)
  const shellCount = useRef(0)
  const wasConnected = useRef(false)
  const canElevate = server.username !== 'root'

  const setTab = useCallback(
    (next: TabId) => {
      setTabState(next)
      setVisited((v) => (v.has(next) ? v : new Set(v).add(next)))
      save(`tab:${server.id}`, next)
    },
    [server.id]
  )

  const newShell = useCallback(
    (su: boolean) => {
      shellCount.current += 1
      const spec = makeTerminal({
        title: `Shell ${shellCount.current}`,
        su: canElevate && su
      })
      setTerminals((list) => [...list, spec])
      setActiveTermId(spec.id)
      setTab('terminal')
    },
    [canElevate, setTab]
  )

  const openTerminal: OpenTerminal = useCallback(
    (opts) => {
      const spec = makeTerminal({
        title: opts.title,
        command: opts.command,
        cwd: opts.cwd,
        su: canElevate && (opts.su ?? server.elevate)
      })
      setTerminals((list) => [...list, spec])
      setActiveTermId(spec.id)
      setTab('terminal')
    },
    [canElevate, server.elevate, setTab]
  )

  const closeTerminal = useCallback((id: string) => {
    setTerminals((list) => {
      const idx = list.findIndex((t) => t.id === id)
      const next = list.filter((t) => t.id !== id)
      setActiveTermId((current) => {
        if (current !== id) return current
        const neighbor = next[Math.min(idx, next.length - 1)]
        return neighbor ? neighbor.id : null
      })
      return next
    })
  }, [])

  useEffect(() => {
    if (server.connected && !wasConnected.current) {
      setTerminals((list) => {
        if (list.length > 0) return list.map((t) => ({ ...t, id: makeTerminal(t).id }))
        shellCount.current = 1
        const spec = makeTerminal({ title: 'Shell 1', su: canElevate && server.elevate })
        return [spec]
      })
    }
    wasConnected.current = server.connected
  }, [server.connected, canElevate, server.elevate])

  useEffect(() => {
    if (terminals.length > 0 && !terminals.some((t) => t.id === activeTermId)) {
      setActiveTermId(terminals[terminals.length - 1].id)
    }
  }, [terminals, activeTermId])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return
      const key = e.key.toLowerCase()
      if (!e.shiftKey && /^[1-5]$/.test(key)) {
        e.preventDefault()
        if (server.connected) setTab(TABS[Number(key) - 1].id)
        return
      }
      if (!server.connected) return
      if (e.shiftKey && key === 't') {
        e.preventDefault()
        newShell(server.elevate)
        return
      }
      if (e.shiftKey && key === 'w') {
        e.preventDefault()
        if (tab === 'terminal' && activeTermId) closeTerminal(activeTermId)
        return
      }
      if (key === 'pageup' || key === 'pagedown') {
        e.preventDefault()
        if (terminals.length < 2) return
        const idx = terminals.findIndex((t) => t.id === activeTermId)
        const delta = key === 'pagedown' ? 1 : -1
        const next = terminals[(idx + delta + terminals.length) % terminals.length]
        setActiveTermId(next.id)
        setTab('terminal')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, server.connected, server.elevate, tab, terminals, activeTermId, newShell, closeTerminal, setTab])

  useEffect(() => {
    if (!active || server.connected || conn?.connecting) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, [role=dialog]')) return
      if (e.key === 'Enter') {
        e.preventDefault()
        onConnect()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, server.connected, conn?.connecting, onConnect])

  const handleDisconnect = () => {
    setTerminals([])
    setActiveTermId(null)
    shellCount.current = 0
    onDisconnect()
  }

  const statusLabel = conn?.connecting ? 'Connecting' : server.connected ? 'Connected' : 'Offline'

  return (
    <div className={`session${active ? '' : ' hidden'}`}>
      <div className="topbar">
        <div className="topbar-title">
          <h2>{server.name}</h2>
          <div className="sub">
            <span className={`status-chip ${server.connected ? 'on' : conn?.connecting ? 'busy' : ''}`}>
              <span className="dot" />
              {statusLabel}
            </span>
            <span className="mono">
              {server.username}@{server.host}
              {server.port !== 22 ? `:${server.port}` : ''}
            </span>
          </div>
        </div>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onEdit} title="Edit server">
            <Icon name="edit" size={14} /> Edit
          </button>
          {server.connected ? (
            <button type="button" className="btn danger" onClick={handleDisconnect}>
              <Icon name="power" size={14} /> Disconnect
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              disabled={conn?.connecting}
              onClick={onConnect}
            >
              {conn?.connecting ? <Spinner /> : <Icon name="play" size={14} />}
              {conn?.connecting ? 'Connecting…' : 'Connect'}
            </button>
          )}
        </div>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            disabled={!server.connected}
            className={`tab ${tab === t.id && server.connected ? 'active' : ''}`}
            title={`${t.label} (Ctrl+${i + 1})`}
            onClick={() => setTab(t.id)}
          >
            <Icon name={t.icon} size={15} />
            {t.label}
            {t.id === 'terminal' && terminals.length > 1 && (
              <span className="tab-count">{terminals.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="content">
        {!server.connected ? (
          <div className="connect-screen">
            <div className="connect-card">
              <div className="connect-icon">
                {conn?.connecting ? <Spinner size={28} /> : <Icon name="server" size={28} />}
              </div>
              <h2>{conn?.connecting ? `Connecting to ${server.name}…` : server.name}</h2>
              <p className="mono muted">
                {server.username}@{server.host}:{server.port} ·{' '}
                {server.authType === 'privateKey' ? 'key auth' : 'password auth'}
              </p>
              {conn?.error && !conn.connecting && (
                <div className="error-banner">
                  <Icon name="alert" size={14} />
                  <span>{conn.error}</span>
                </div>
              )}
              {!conn?.connecting && (
                <div className="connect-actions">
                  <button type="button" className="btn primary large" onClick={onConnect}>
                    <Icon name="play" size={14} />
                    {conn?.error ? 'Retry' : 'Connect'}
                  </button>
                  <button type="button" className="btn large" onClick={onEdit}>
                    <Icon name="edit" size={14} /> Edit server
                  </button>
                </div>
              )}
              {!conn?.connecting && (
                <p className="muted hint">
                  Press <Kbd>Enter</Kbd> to connect
                </p>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className={`tab-pane${tab === 'terminal' ? '' : ' hidden'}`}>
              <TerminalWorkspace
                serverId={server.id}
                terminals={terminals}
                activeTermId={activeTermId}
                visible={active && tab === 'terminal'}
                fontSize={fontSize}
                canElevate={canElevate}
                defaultSu={server.elevate}
                onSelect={setActiveTermId}
                onNew={newShell}
                onClose={closeTerminal}
              />
            </div>
            {visited.has('files') && (
              <div className={`tab-pane${tab === 'files' ? '' : ' hidden'}`}>
                <FileManagerPanel
                  serverId={server.id}
                  active={active && tab === 'files'}
                  onOpenTerminal={openTerminal}
                />
              </div>
            )}
            {visited.has('docker') && (
              <div className={`tab-pane${tab === 'docker' ? '' : ' hidden'}`}>
                <DockerPanel
                  serverId={server.id}
                  host={server.host}
                  active={active && tab === 'docker'}
                  onOpenTerminal={openTerminal}
                />
              </div>
            )}
            {visited.has('resources') && (
              <div className={`tab-pane${tab === 'resources' ? '' : ' hidden'}`}>
                <ResourcesPanel serverId={server.id} active={active && tab === 'resources'} />
              </div>
            )}
            {visited.has('tailscale') && (
              <div className={`tab-pane${tab === 'tailscale' ? '' : ' hidden'}`}>
                <TailscalePanel serverId={server.id} active={active && tab === 'tailscale'} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
