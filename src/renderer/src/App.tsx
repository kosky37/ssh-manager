import { useCallback, useEffect, useState } from 'react'
import ServerSidebar from './components/ServerSidebar'
import SessionView from './components/SessionView'
import type { ServerInfo } from './types'

export default function App() {
  const [servers, setServers] = useState<ServerInfo[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const list = (await window.api.servers.list()) as ServerInfo[]
    setServers(list)
    if (!selectedId && list.length > 0) {
      setSelectedId(list[0].id)
    }
  }, [selectedId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const selected = servers.find((s) => s.id === selectedId) || null

  const connect = async (_su = false) => {
    if (!selected) return false
    setBusy(true)
    setError(null)
    const result = await window.api.servers.connect(selected.id)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return false
    }
    await refresh()
    return true
  }

  const disconnect = async () => {
    if (!selected) return
    setBusy(true)
    await window.api.servers.disconnect(selected.id)
    setBusy(false)
    await refresh()
  }

  return (
    <div className="app">
      <ServerSidebar
        servers={servers}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onRefresh={refresh}
      />
      <main className="main">
        {selected ? (
          <SessionView
            key={selected.id}
            server={selected}
            busy={busy}
            error={error}
            onConnect={connect}
            onDisconnect={disconnect}
            onClearError={() => setError(null)}
          />
        ) : (
          <div className="empty">
            <h2>No servers configured</h2>
            <p>
              Copy <span className="mono">servers.example.json</span> to{' '}
              <span className="mono">servers.json</span> and fill in credentials.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
