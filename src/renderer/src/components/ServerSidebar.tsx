import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { ServerInfo } from '../types'
import { Icon, Kbd, Spinner, useContextMenu, type MenuEntry } from './ui'

export interface ConnState {
  connecting?: boolean
  error?: string
}

interface Props {
  servers: ServerInfo[]
  selectedId: string | null
  conn: Record<string, ConnState>
  collapsed: boolean
  onToggleCollapsed: () => void
  onSelect: (id: string) => void
  onConnect: (id: string) => void
  onDisconnect: (id: string) => void
  onAdd: () => void
  onEdit: (server: ServerInfo) => void
  onDuplicate: (server: ServerInfo) => void
  onDelete: (server: ServerInfo) => void
  onReorder: (ids: string[]) => void
  onImport: () => void
  onOpenConfig: () => void
  onShowShortcuts: () => void
  onCopy: (text: string, what: string) => void
}

export interface SidebarHandle {
  focusSearch: () => void
}

function initials(name: string): string {
  const parts = name.trim().split(/[\s\-_.]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function sshCommand(s: ServerInfo): string {
  return `ssh ${s.port && s.port !== 22 ? `-p ${s.port} ` : ''}${s.username}@${s.host}`
}

const ServerSidebar = forwardRef<SidebarHandle, Props>(function ServerSidebar(props, ref) {
  const {
    servers,
    selectedId,
    conn,
    collapsed,
    onToggleCollapsed,
    onSelect,
    onConnect,
    onDisconnect,
    onAdd,
    onEdit,
    onDuplicate,
    onDelete,
    onReorder,
    onImport,
    onOpenConfig,
    onShowShortcuts,
    onCopy
  } = props
  const [query, setQuery] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const menu = useContextMenu()

  useImperativeHandle(ref, () => ({
    focusSearch: () => {
      searchRef.current?.focus()
      searchRef.current?.select()
    }
  }))

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return servers
    return servers.filter((s) =>
      [s.name, s.host, s.username].some((v) => v.toLowerCase().includes(q))
    )
  }, [servers, query])

  const connectedCount = servers.filter((s) => s.connected).length

  const serverMenu = (server: ServerInfo): MenuEntry[] => [
    server.connected
      ? { label: 'Disconnect', icon: 'power', onSelect: () => onDisconnect(server.id) }
      : { label: 'Connect', icon: 'play', onSelect: () => onConnect(server.id) },
    'separator',
    { label: 'Edit…', icon: 'edit', onSelect: () => onEdit(server) },
    { label: 'Duplicate…', icon: 'copy', onSelect: () => onDuplicate(server) },
    {
      label: 'Copy SSH command',
      icon: 'terminal',
      onSelect: () => onCopy(sshCommand(server), 'SSH command')
    },
    { label: 'Copy host', icon: 'link', onSelect: () => onCopy(server.host, 'Host') },
    'separator',
    { label: 'Delete', icon: 'trash', danger: true, onSelect: () => onDelete(server) }
  ]

  const appMenu = (): MenuEntry[] => [
    { label: 'Add server…', icon: 'plus', hint: 'Ctrl+Shift+N', onSelect: onAdd },
    { label: 'Import servers…', icon: 'import', onSelect: onImport },
    { label: 'Show config file', icon: 'folder', onSelect: onOpenConfig },
    'separator',
    { label: 'Keyboard shortcuts', icon: 'keyboard', hint: 'F1', onSelect: onShowShortcuts }
  ]

  const handleDrop = () => {
    if (!dragId || !dropTarget || dragId === dropTarget.id) return
    const ids = servers.map((s) => s.id).filter((id) => id !== dragId)
    const idx = ids.indexOf(dropTarget.id)
    ids.splice(dropTarget.after ? idx + 1 : idx, 0, dragId)
    onReorder(ids)
  }

  if (collapsed) {
    return (
      <aside className="sidebar collapsed">
        <button
          type="button"
          className="icon-btn sidebar-toggle"
          title="Expand sidebar (Ctrl+Shift+B)"
          onClick={onToggleCollapsed}
        >
          <Icon name="sidebar" />
        </button>
        <div className="mini-list">
          {servers.map((server) => {
            const c = conn[server.id]
            return (
              <button
                key={server.id}
                type="button"
                title={`${server.name}\n${server.username}@${server.host}`}
                className={`mini-card ${selectedId === server.id ? 'active' : ''}`}
                onClick={() => onSelect(server.id)}
                onDoubleClick={() => !server.connected && onConnect(server.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  menu.open(e, serverMenu(server))
                }}
              >
                {initials(server.name)}
                <span
                  className={`dot ${server.connected ? 'on' : ''} ${c?.connecting ? 'busy' : ''} ${c?.error ? 'err' : ''}`}
                />
              </button>
            )
          })}
        </div>
        <button type="button" className="icon-btn" title="Add server" onClick={onAdd}>
          <Icon name="plus" />
        </button>
        {menu.element}
      </aside>
    )
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <div>
          <div className="brand-mark">Remote ops</div>
          <h1>SSH Manager</h1>
        </div>
        <button
          type="button"
          className="icon-btn"
          title="Collapse sidebar (Ctrl+Shift+B)"
          onClick={onToggleCollapsed}
        >
          <Icon name="sidebar" />
        </button>
      </div>

      <div className="search-box">
        <Icon name="search" size={14} />
        <input
          ref={searchRef}
          type="text"
          placeholder="Find server…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setQuery('')
              ;(e.target as HTMLInputElement).blur()
            }
            if (e.key === 'Enter' && filtered[0]) {
              onSelect(filtered[0].id)
              if (!filtered[0].connected) onConnect(filtered[0].id)
              setQuery('')
              ;(e.target as HTMLInputElement).blur()
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const idx = filtered.findIndex((s) => s.id === selectedId)
              const next =
                e.key === 'ArrowDown'
                  ? filtered[Math.min(filtered.length - 1, idx + 1)]
                  : filtered[Math.max(0, idx - 1)]
              if (next) onSelect(next.id)
            }
          }}
        />
        {!query && <Kbd>Ctrl+Shift+K</Kbd>}
      </div>

      <div className="section-label">
        <span>Servers</span>
        <span className="muted">
          {connectedCount > 0 ? `${connectedCount} connected` : `${servers.length}`}
        </span>
      </div>

      <div className="server-list">
        {filtered.map((server) => {
          const c = conn[server.id]
          const status = c?.connecting
            ? 'Connecting…'
            : server.connected
              ? 'Connected'
              : c?.error
                ? 'Failed'
                : 'Offline'
          return (
            <div
              key={server.id}
              role="button"
              tabIndex={0}
              draggable={!query}
              className={`server-card ${selectedId === server.id ? 'active' : ''} ${
                dragId === server.id ? 'dragging' : ''
              } ${dropTarget?.id === server.id ? (dropTarget.after ? 'drop-after' : 'drop-before') : ''}`}
              onClick={() => onSelect(server.id)}
              onDoubleClick={() => !server.connected && onConnect(server.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onSelect(server.id)
                  if (!server.connected) onConnect(server.id)
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                onSelect(server.id)
                menu.open(e, serverMenu(server))
              }}
              onDragStart={(e) => {
                setDragId(server.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', server.id)
              }}
              onDragOver={(e) => {
                if (!dragId) return
                e.preventDefault()
                const rect = e.currentTarget.getBoundingClientRect()
                setDropTarget({ id: server.id, after: e.clientY > rect.top + rect.height / 2 })
              }}
              onDrop={(e) => {
                e.preventDefault()
                handleDrop()
                setDragId(null)
                setDropTarget(null)
              }}
              onDragEnd={() => {
                setDragId(null)
                setDropTarget(null)
              }}
            >
              <div className="server-avatar">
                {initials(server.name)}
                <span
                  className={`dot ${server.connected ? 'on' : ''} ${c?.connecting ? 'busy' : ''} ${c?.error && !server.connected ? 'err' : ''}`}
                />
              </div>
              <div className="server-text">
                <h3>{server.name}</h3>
                <div className="server-meta">
                  {server.username}@{server.host}
                  {server.port && server.port !== 22 ? `:${server.port}` : ''}
                </div>
                <div className="server-status">{status}</div>
              </div>
              <div className="server-actions">
                {c?.connecting ? (
                  <Spinner />
                ) : server.connected ? (
                  <button
                    type="button"
                    className="icon-btn"
                    title="Disconnect"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDisconnect(server.id)
                    }}
                  >
                    <Icon name="power" size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="icon-btn"
                    title="Connect"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect(server.id)
                      onConnect(server.id)
                    }}
                  >
                    <Icon name="play" size={14} />
                  </button>
                )}
                <button
                  type="button"
                  className="icon-btn"
                  title="More"
                  onClick={(e) => {
                    e.stopPropagation()
                    menu.open(e, serverMenu(server))
                  }}
                >
                  <Icon name="more" size={14} />
                </button>
              </div>
            </div>
          )
        })}
        {servers.length > 0 && filtered.length === 0 && (
          <div className="muted sidebar-empty">No servers match “{query}”.</div>
        )}
        {servers.length === 0 && (
          <div className="muted sidebar-empty">No servers yet. Add one to get started.</div>
        )}
      </div>

      <div className="sidebar-foot">
        <button type="button" className="btn primary grow" onClick={onAdd}>
          <Icon name="plus" size={14} /> Add server
        </button>
        <button
          type="button"
          className="icon-btn"
          title="More options"
          onClick={(e) => menu.open(e, appMenu())}
        >
          <Icon name="more" />
        </button>
      </div>
      {menu.element}
    </aside>
  )
})

export default ServerSidebar
