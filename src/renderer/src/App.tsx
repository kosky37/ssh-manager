import { useCallback, useEffect, useRef, useState } from 'react'
import ServerSidebar, { type ConnState, type SidebarHandle } from './components/ServerSidebar'
import SessionView from './components/SessionView'
import ServerEditor, { type EditorState } from './components/ServerEditor'
import { Icon, Kbd, Modal, useDialog, useToast } from './components/ui'
import type { ServerInfo } from './types'
import { errorMessage } from './lib/format'
import { load, save } from './lib/storage'

const SHORTCUTS: [string, string][] = [
  ['Ctrl+Shift+K', 'Find server'],
  ['Ctrl+Shift+N', 'Add server'],
  ['Ctrl+Tab / Ctrl+Shift+Tab', 'Next / previous server'],
  ['Ctrl+Shift+B', 'Toggle sidebar'],
  ['Ctrl+1 … Ctrl+5', 'Switch tab'],
  ['Ctrl+Shift+T', 'New terminal'],
  ['Ctrl+Shift+W', 'Close terminal'],
  ['Ctrl+PageUp / PageDown', 'Previous / next terminal'],
  ['Ctrl+Shift+C / Ctrl+Shift+V', 'Copy / paste in terminal'],
  ['Right-click', 'Copy selection or paste in terminal'],
  ['Ctrl+Shift+F', 'Find in terminal'],
  ['Ctrl+= / Ctrl+- / Ctrl+0', 'Terminal font size'],
  ['Ctrl+F / Ctrl+L', 'Filter files / edit path'],
  ['F2 / Del / F5', 'Rename / delete / refresh files'],
  ['Alt+← / Alt+→', 'Back / forward in files'],
  ['F1', 'Show this list']
]

export default function App() {
  const [servers, setServers] = useState<ServerInfo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selectedId, setSelectedIdState] = useState<string | null>(() => load('selected', null))
  const [conn, setConn] = useState<Record<string, ConnState>>({})
  const [mounted, setMounted] = useState<Set<string>>(new Set())
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [collapsed, setCollapsed] = useState<boolean>(() => load('sidebarCollapsed', false))
  const [fontSize, setFontSize] = useState<number>(() => load('terminalFontSize', 13))
  const sidebarRef = useRef<SidebarHandle>(null)
  const serversRef = useRef(servers)
  serversRef.current = servers
  const toast = useToast()
  const dialog = useDialog()

  const setSelectedId = useCallback((id: string | null) => {
    setSelectedIdState(id)
    save('selected', id)
    if (id) setMounted((m) => (m.has(id) ? m : new Set(m).add(id)))
  }, [])

  const refresh = useCallback(async () => {
    const list = await window.api.servers.list()
    setServers(list)
    setLoaded(true)
    setSelectedIdState((current) => {
      const next = current && list.some((s) => s.id === current) ? current : list[0]?.id ?? null
      if (next) setMounted((m) => (m.has(next) ? m : new Set(m).add(next)))
      return next
    })
  }, [])

  useEffect(() => {
    void refresh()
    const offChanged = window.api.servers.onChanged(() => void refresh())
    const offStatus = window.api.servers.onStatus((payload) => {
      setServers((list) =>
        list.map((s) => (s.id === payload.serverId ? { ...s, connected: payload.connected } : s))
      )
      if (payload.lost) {
        const server = serversRef.current.find((s) => s.id === payload.serverId)
        setConn((c) => ({ ...c, [payload.serverId]: { error: 'Connection lost' } }))
        toast({
          kind: 'error',
          title: `Connection to ${server?.name || payload.serverId} lost`,
          action: { label: 'Reconnect', onClick: () => void connectRef.current(payload.serverId) },
          duration: 0
        })
      }
    })
    return () => {
      offChanged()
      offStatus()
    }
  }, [refresh, toast])

  const connect = useCallback(
    async (id: string) => {
      setMounted((m) => (m.has(id) ? m : new Set(m).add(id)))
      setConn((c) => ({ ...c, [id]: { connecting: true } }))
      try {
        const result = await window.api.servers.connect(id)
        setConn((c) => ({ ...c, [id]: result.ok ? {} : { error: result.error } }))
        if (result.ok) {
          setServers((list) => list.map((s) => (s.id === id ? { ...s, connected: true } : s)))
        } else {
          const server = serversRef.current.find((s) => s.id === id)
          toast({ kind: 'error', title: `Could not connect to ${server?.name || id}`, detail: result.error })
        }
      } catch (e) {
        setConn((c) => ({ ...c, [id]: { error: errorMessage(e) } }))
      }
    },
    [toast]
  )
  const connectRef = useRef(connect)
  connectRef.current = connect

  const disconnect = useCallback(async (id: string) => {
    await window.api.servers.disconnect(id)
    setConn((c) => ({ ...c, [id]: {} }))
    setServers((list) => list.map((s) => (s.id === id ? { ...s, connected: false } : s)))
  }, [])

  const remove = useCallback(
    async (server: ServerInfo) => {
      const ok = await dialog.confirm({
        title: `Delete ${server.name}?`,
        message: (
          <>
            <span className="mono">
              {server.username}@{server.host}
            </span>{' '}
            and its saved credentials will be removed from SSH Manager.
          </>
        ),
        confirmLabel: 'Delete',
        danger: true
      })
      if (!ok) return
      await window.api.servers.remove(server.id)
      setMounted((m) => {
        const next = new Set(m)
        next.delete(server.id)
        return next
      })
      toast({ kind: 'success', title: `Deleted ${server.name}` })
      await refresh()
    },
    [dialog, refresh, toast]
  )

  const reorder = useCallback(async (ids: string[]) => {
    setServers((list) => ids.map((id) => list.find((s) => s.id === id)!).filter(Boolean))
    await window.api.servers.reorder(ids)
  }, [])

  const importServers = useCallback(async () => {
    const res = await window.api.servers.import()
    if (res.count > 0) toast({ kind: 'success', title: `Imported ${res.count} server(s)` })
    await refresh()
  }, [refresh, toast])

  const copyText = useCallback(
    (text: string, what: string) => {
      window.api.clipboard.writeText(text)
      toast({ kind: 'success', title: `${what} copied`, detail: text })
    },
    [toast]
  )

  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => {
      save('sidebarCollapsed', !v)
      return !v
    })
  }, [])

  const changeFont = useCallback((delta: number | null) => {
    setFontSize((size) => {
      const next = delta === null ? 13 : Math.max(9, Math.min(24, size + delta))
      save('terminalFontSize', next)
      return next
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role=dialog]')) return
      const key = e.key.toLowerCase()
      if (key === 'f1') {
        e.preventDefault()
        setShowShortcuts(true)
        return
      }
      if (!e.ctrlKey || e.altKey) return
      if (e.shiftKey && key === 'k') {
        e.preventDefault()
        if (collapsed) toggleCollapsed()
        requestAnimationFrame(() => sidebarRef.current?.focusSearch())
      } else if (e.shiftKey && key === 'n') {
        e.preventDefault()
        setEditor({ mode: 'add' })
      } else if (e.shiftKey && key === 'b') {
        e.preventDefault()
        toggleCollapsed()
      } else if (key === 'tab') {
        e.preventDefault()
        const list = serversRef.current
        if (list.length < 2) return
        const idx = list.findIndex((s) => s.id === selectedId)
        const next = list[(idx + (e.shiftKey ? -1 : 1) + list.length) % list.length]
        setSelectedId(next.id)
      } else if (!e.shiftKey && (key === '=' || key === '+')) {
        e.preventDefault()
        changeFont(1)
      } else if (!e.shiftKey && key === '-') {
        e.preventDefault()
        changeFont(-1)
      } else if (!e.shiftKey && key === '0') {
        e.preventDefault()
        changeFont(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [collapsed, selectedId, setSelectedId, toggleCollapsed, changeFont])

  const selected = servers.find((s) => s.id === selectedId) || null

  return (
    <div className={`app${collapsed ? ' sidebar-collapsed' : ''}`}>
      <ServerSidebar
        ref={sidebarRef}
        servers={servers}
        selectedId={selectedId}
        conn={conn}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        onSelect={setSelectedId}
        onConnect={(id) => void connect(id)}
        onDisconnect={(id) => void disconnect(id)}
        onAdd={() => setEditor({ mode: 'add' })}
        onEdit={(server) => setEditor({ mode: 'edit', server })}
        onDuplicate={(server) => setEditor({ mode: 'duplicate', server })}
        onDelete={(server) => void remove(server)}
        onReorder={(ids) => void reorder(ids)}
        onImport={() => void importServers()}
        onOpenConfig={() => void window.api.servers.openConfigDir()}
        onShowShortcuts={() => setShowShortcuts(true)}
        onCopy={copyText}
      />
      <main className="main">
        {servers
          .filter((s) => mounted.has(s.id))
          .map((server) => (
            <SessionView
              key={server.id}
              server={server}
              active={server.id === selected?.id}
              conn={conn[server.id]}
              fontSize={fontSize}
              onConnect={() => void connect(server.id)}
              onDisconnect={() => void disconnect(server.id)}
              onEdit={() => setEditor({ mode: 'edit', server })}
            />
          ))}
        {loaded && servers.length === 0 && (
          <div className="welcome">
            <div className="welcome-card">
              <div className="brand-mark">Remote ops</div>
              <h2>Welcome to SSH Manager</h2>
              <p className="muted">
                Terminals, Docker, Tailscale, system resources and files for your Linux hosts — in
                one window.
              </p>
              <div className="connect-actions">
                <button type="button" className="btn primary large" onClick={() => setEditor({ mode: 'add' })}>
                  <Icon name="plus" size={14} /> Add your first server
                </button>
                <button type="button" className="btn large" onClick={() => void importServers()}>
                  <Icon name="import" size={14} /> Import servers.json
                </button>
              </div>
              <p className="muted hint">
                Press <Kbd>F1</Kbd> any time for keyboard shortcuts.
              </p>
            </div>
          </div>
        )}
      </main>

      {editor && (
        <ServerEditor
          state={editor}
          onClose={() => setEditor(null)}
          onSaved={async (server) => {
            const mode = editor.mode
            setEditor(null)
            await refresh()
            setSelectedId(server.id)
            toast({
              kind: 'success',
              title: mode === 'edit' ? `Saved ${server.name}` : `Added ${server.name}`,
              action: server.connected
                ? undefined
                : { label: 'Connect', onClick: () => void connect(server.id) }
            })
          }}
        />
      )}

      {showShortcuts && (
        <Modal title="Keyboard shortcuts" onClose={() => setShowShortcuts(false)} width={520}>
          <table className="shortcuts-table">
            <tbody>
              {SHORTCUTS.map(([keys, label]) => (
                <tr key={keys}>
                  <td>
                    <Kbd>{keys}</Kbd>
                  </td>
                  <td>{label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
    </div>
  )
}
