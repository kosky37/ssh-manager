import { EventEmitter } from 'events'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, isAbsolute, join, resolve } from 'path'
import { app, safeStorage } from 'electron'
import type { ServerConfig, ServerInfo, ServerInput } from '../types'
import { SshSession } from './session'

const ENC_PREFIX = 'enc:'

function configPath(): string {
  return join(app.getPath('userData'), 'servers.json')
}

function encrypt(value?: string): string | undefined {
  if (!value) return undefined
  if (!safeStorage.isEncryptionAvailable()) return value
  return ENC_PREFIX + safeStorage.encryptString(value).toString('base64')
}

function decrypt(value?: string): string | undefined {
  if (!value) return undefined
  if (!value.startsWith(ENC_PREFIX)) return value
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'))
  } catch {
    return undefined
  }
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'server'
  )
}

function normalize(raw: Partial<ServerConfig>, baseDir: string): ServerConfig | null {
  if (!raw || typeof raw !== 'object' || !raw.host || !raw.username) return null
  const keyPath = raw.privateKeyPath?.trim()
  return {
    id: String(raw.id || slugify(raw.name || raw.host)),
    name: String(raw.name || raw.host),
    host: String(raw.host),
    port: Number(raw.port) || 22,
    username: String(raw.username),
    authType: raw.authType === 'privateKey' ? 'privateKey' : 'password',
    password: decrypt(raw.password),
    privateKeyPath:
      keyPath && !isAbsolute(keyPath) && !keyPath.startsWith('~')
        ? resolve(baseDir, keyPath)
        : keyPath || undefined,
    passphrase: decrypt(raw.passphrase),
    elevate: raw.elevate
  }
}

export function toInfo(server: ServerConfig, connected: boolean): ServerInfo {
  return {
    id: server.id,
    name: server.name,
    host: server.host,
    port: server.port || 22,
    username: server.username,
    authType: server.authType,
    privateKeyPath: server.privateKeyPath,
    hasPassword: !!server.password,
    hasPassphrase: !!server.passphrase,
    elevate: server.elevate ?? server.username !== 'root',
    connected
  }
}

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, SshSession>()
  private connecting = new Map<string, Promise<{ ok: true } | { ok: false; error: string }>>()
  private servers: ServerConfig[] = []

  loadServers(): ServerConfig[] {
    const path = configPath()
    if (existsSync(path)) {
      this.servers = this.parseFile(path)
      return this.servers
    }
    const legacy = join(process.cwd(), 'servers.json')
    this.servers = existsSync(legacy) ? this.parseFile(legacy) : []
    if (this.servers.length > 0) this.persist()
    return this.servers
  }

  private parseFile(path: string): ServerConfig[] {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ServerConfig>[]
      if (!Array.isArray(parsed)) return []
      return parsed
        .map((item) => normalize(item, dirname(path)))
        .filter((item): item is ServerConfig => item !== null)
    } catch {
      return []
    }
  }

  private persist(): void {
    const path = configPath()
    mkdirSync(dirname(path), { recursive: true })
    const stored = this.servers.map((s) => ({
      ...s,
      password: encrypt(s.password),
      passphrase: encrypt(s.passphrase)
    }))
    writeFileSync(path, JSON.stringify(stored, null, 2), 'utf-8')
  }

  get configFile(): string {
    return configPath()
  }

  getServers(): ServerConfig[] {
    return this.servers
  }

  listInfo(): ServerInfo[] {
    return this.servers.map((s) => toInfo(s, this.isConnected(s.id)))
  }

  getServer(id: string): ServerConfig | undefined {
    return this.servers.find((s) => s.id === id)
  }

  private uniqueId(base: string): string {
    let id = slugify(base)
    let n = 2
    while (this.servers.some((s) => s.id === id)) {
      id = `${slugify(base)}-${n++}`
    }
    return id
  }

  resolveInput(input: ServerInput): ServerConfig {
    const prev = input.id ? this.getServer(input.id) : undefined
    return {
      id: prev?.id || this.uniqueId(input.name || input.host),
      name: input.name.trim() || input.host.trim(),
      host: input.host.trim(),
      port: Number(input.port) || 22,
      username: input.username.trim(),
      authType: input.authType,
      password: input.password === undefined ? prev?.password : input.password || undefined,
      privateKeyPath: input.privateKeyPath?.trim() || undefined,
      passphrase:
        input.passphrase === undefined ? prev?.passphrase : input.passphrase || undefined,
      elevate: input.elevate
    }
  }

  upsert(input: ServerInput): ServerInfo {
    const next = this.resolveInput(input)
    const idx = this.servers.findIndex((s) => s.id === next.id)
    if (idx >= 0) {
      const prev = this.servers[idx]
      this.servers[idx] = next
      const changed =
        prev.host !== next.host ||
        prev.port !== next.port ||
        prev.username !== next.username ||
        prev.authType !== next.authType ||
        prev.password !== next.password ||
        prev.privateKeyPath !== next.privateKeyPath ||
        prev.passphrase !== next.passphrase
      if (changed) this.disconnect(next.id)
    } else {
      this.servers.push(next)
    }
    this.persist()
    this.emit('changed')
    return toInfo(next, this.isConnected(next.id))
  }

  remove(id: string): void {
    this.disconnect(id)
    this.servers = this.servers.filter((s) => s.id !== id)
    this.persist()
    this.emit('changed')
  }

  reorder(ids: string[]): void {
    const rank = new Map(ids.map((id, i) => [id, i]))
    this.servers = [...this.servers].sort(
      (a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity)
    )
    this.persist()
    this.emit('changed')
  }

  importFrom(path: string): number {
    const incoming = this.parseFile(path)
    for (const server of incoming) {
      const idx = this.servers.findIndex((s) => s.id === server.id)
      if (idx >= 0) this.servers[idx] = server
      else this.servers.push(server)
    }
    if (incoming.length > 0) {
      this.persist()
      this.emit('changed')
    }
    return incoming.length
  }

  async test(input: ServerInput): Promise<{ ok: true } | { ok: false; error: string }> {
    const session = new SshSession(this.resolveInput(input))
    try {
      await session.connect()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      session.disconnect()
    }
  }

  connect(serverId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const pending = this.connecting.get(serverId)
    if (pending) return pending
    const promise = this.doConnect(serverId).finally(() => this.connecting.delete(serverId))
    this.connecting.set(serverId, promise)
    return promise
  }

  private async doConnect(
    serverId: string
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const config = this.getServer(serverId)
    if (!config) {
      return { ok: false, error: `Server not found: ${serverId}` }
    }

    let session = this.sessions.get(serverId)
    if (session?.isConnected) {
      return { ok: true }
    }

    if (session) {
      session.disconnect()
      this.sessions.delete(serverId)
    }

    session = new SshSession(config)
    try {
      await session.connect()
      this.sessions.set(serverId, session)
      const owned = session
      owned.onClose(() => {
        if (this.sessions.get(serverId) === owned) {
          this.sessions.delete(serverId)
          this.emit('status', { serverId, connected: false, lost: true })
        }
      })
      this.emit('status', { serverId, connected: true })
      return { ok: true }
    } catch (err) {
      this.sessions.delete(serverId)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  disconnect(serverId: string): void {
    const session = this.sessions.get(serverId)
    if (session) {
      this.sessions.delete(serverId)
      session.disconnect()
      this.emit('status', { serverId, connected: false, lost: false })
    }
  }

  getSession(serverId: string): SshSession {
    const session = this.sessions.get(serverId)
    if (!session || !session.isConnected) {
      throw new Error(`Not connected to ${this.getServer(serverId)?.name || serverId}`)
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
