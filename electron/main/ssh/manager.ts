import { readFileSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ServerConfig } from '../types'
import { SshSession } from './session'

const CONFIG_PATH = join(process.cwd(), 'servers.json')

export class SessionManager {
  private sessions = new Map<string, SshSession>()
  private servers: ServerConfig[] = []

  loadServers(): ServerConfig[] {
    if (!existsSync(CONFIG_PATH)) {
      this.servers = []
      return this.servers
    }
    const raw = readFileSync(CONFIG_PATH, 'utf-8')
    this.servers = JSON.parse(raw) as ServerConfig[]
    return this.servers
  }

  saveServers(servers: ServerConfig[]): void {
    this.servers = servers
    writeFileSync(CONFIG_PATH, JSON.stringify(servers, null, 2), 'utf-8')
  }

  getServers(): ServerConfig[] {
    if (this.servers.length === 0) {
      this.loadServers()
    }
    return this.servers
  }

  getServer(id: string): ServerConfig | undefined {
    return this.getServers().find((s) => s.id === id)
  }

  async connect(serverId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const config = this.getServer(serverId)
    if (!config) {
      return { ok: false, error: `Server not found: ${serverId}` }
    }

    let session = this.sessions.get(serverId)
    if (session?.isConnected) {
      return { ok: true }
    }

    // Drop a stale (disconnected) entry so we don't leak the old Client.
    if (session) {
      session.disconnect()
      this.sessions.delete(serverId)
    }

    session = new SshSession(config)
    try {
      await session.connect()
      this.sessions.set(serverId, session)
      return { ok: true }
    } catch (err) {
      this.sessions.delete(serverId)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  disconnect(serverId: string): void {
    const session = this.sessions.get(serverId)
    if (session) {
      session.disconnect()
      this.sessions.delete(serverId)
    }
  }

  getSession(serverId: string): SshSession {
    const session = this.sessions.get(serverId)
    if (!session || !session.isConnected) {
      throw new Error(`No active session for ${serverId}`)
    }
    return session
  }

  isConnected(serverId: string): boolean {
    return this.sessions.get(serverId)?.isConnected ?? false
  }

  disconnectAll(): void {
    for (const [id, session] of this.sessions) {
      session.disconnect()
      this.sessions.delete(id)
    }
  }
}

export const sessionManager = new SessionManager()
