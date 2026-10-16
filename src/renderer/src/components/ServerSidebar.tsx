import type { ServerInfo } from '../types'

interface Props {
  servers: ServerInfo[]
  selectedId: string | null
  onSelect: (id: string) => void
  onRefresh: () => void
}

export default function ServerSidebar({ servers, selectedId, onSelect, onRefresh }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">Remote ops</div>
        <h1>SSH Manager</h1>
        <p>Terminal, Docker, Tailscale, files.</p>
      </div>

      <div className="panel-toolbar" style={{ marginBottom: 0 }}>
        <strong style={{ fontSize: '0.85rem' }}>Servers</strong>
        <span className="spacer" />
        <button className="btn" type="button" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      <div className="server-list">
        {servers.map((server) => (
          <button
            key={server.id}
            type="button"
            className={`server-card ${selectedId === server.id ? 'active' : ''}`}
            onClick={() => onSelect(server.id)}
          >
            <h3>{server.name}</h3>
            <div className="server-meta">
              {server.username}@{server.host}:{server.port || 22}
            </div>
            <div className="badge">
              <span className={`dot ${server.connected ? 'on' : ''}`} />
              {server.connected ? 'Connected' : 'Offline'}
              <span>·</span>
              {server.authType === 'privateKey' ? 'key' : 'password'}
            </div>
          </button>
        ))}
      </div>
    </aside>
  )
}
