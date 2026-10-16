import { Client, ClientChannel, SFTPWrapper } from 'ssh2'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { resolve } from 'path'
import type { ExecResult, ServerConfig } from '../types'

export class SshSession {
  readonly id: string
  readonly config: ServerConfig
  private client: Client | null = null
  private connected = false
  /** Reused across file ops — opening a new SFTP channel per call exhausts MaxSessions. */
  private sftpSession: SFTPWrapper | null = null
  private sftpOpening: Promise<SFTPWrapper> | null = null
  private closeListeners = new Set<() => void>()

  constructor(config: ServerConfig) {
    this.id = config.id
    this.config = config
  }

  get isConnected(): boolean {
    return this.connected
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  connect(): Promise<void> {
    if (this.connected && this.client) {
      return Promise.resolve()
    }

    return new Promise((resolvePromise, reject) => {
      const client = new Client()
      this.client = client
      this.clearSftp()

      client.on('ready', () => {
        this.connected = true
        resolvePromise()
      })

      client.on('error', (err) => {
        this.connected = false
        this.clearSftp()
        reject(err)
      })

      client.on('close', () => {
        const wasConnected = this.connected
        this.connected = false
        this.clearSftp()
        if (wasConnected && this.client === client) {
          for (const listener of this.closeListeners) listener()
        }
      })

      const connectOpts: Record<string, unknown> = {
        host: this.config.host,
        port: this.config.port || 22,
        username: this.config.username,
        readyTimeout: 20000,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3
      }

      if (this.config.authType === 'privateKey') {
        const raw = (this.config.privateKeyPath || '').trim()
        if (!raw) {
          reject(new Error('No private key file configured'))
          return
        }
        const keyPath = resolve(raw.replace(/^~(?=$|[\\/])/, homedir()))
        try {
          connectOpts.privateKey = readFileSync(keyPath)
        } catch {
          reject(new Error(`Cannot read private key: ${keyPath}`))
          return
        }
        if (this.config.passphrase) {
          connectOpts.passphrase = this.config.passphrase
        }
      } else {
        connectOpts.password = this.config.password
      }

      client.connect(connectOpts)
    })
  }

  disconnect(): void {
    this.clearSftp()
    const client = this.client
    this.client = null
    this.connected = false
    client?.end()
  }

  private clearSftp(): void {
    const sftp = this.sftpSession
    this.sftpSession = null
    this.sftpOpening = null
    if (sftp) {
      try {
        sftp.end()
      } catch {
        // already closed
      }
    }
  }

  private ensureClient(): Client {
    if (!this.client || !this.connected) {
      throw new Error(`Not connected to ${this.config.name}`)
    }
    return this.client
  }

  exec(command: string, timeoutMs = 60000): Promise<ExecResult> {
    const client = this.ensureClient()

    return new Promise((resolvePromise, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          reject(new Error(`Command timed out after ${timeoutMs}ms`))
        }
      }, timeoutMs)

      client.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer)
          if (!settled) {
            settled = true
            reject(err)
          }
          return
        }

        let stdout = ''
        let stderr = ''

        stream.on('close', (code: number | null) => {
          clearTimeout(timer)
          if (!settled) {
            settled = true
            resolvePromise({ stdout, stderr, code })
          }
        })

        stream.on('data', (data: Buffer) => {
          stdout += data.toString()
        })

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString()
        })
      })
    })
  }

  shell(cols = 120, rows = 30): Promise<ClientChannel> {
    const client = this.ensureClient()

    return new Promise((resolvePromise, reject) => {
      client.shell(
        { term: 'xterm-256color', cols, rows },
        (err, stream) => {
          if (err) reject(err)
          else resolvePromise(stream)
        }
      )
    })
  }

  /** One shared SFTP channel per connection; recreates if the previous one died. */
  async sftp(): Promise<SFTPWrapper> {
    try {
      return await this.openSftp()
    } catch {
      this.clearSftp()
      return this.openSftp()
    }
  }

  private openSftp(): Promise<SFTPWrapper> {
    if (this.sftpSession) {
      return Promise.resolve(this.sftpSession)
    }
    if (this.sftpOpening) {
      return this.sftpOpening
    }

    const client = this.ensureClient()
    this.sftpOpening = new Promise((resolvePromise, reject) => {
      client.sftp((err, sftp) => {
        this.sftpOpening = null
        if (err) {
          reject(err)
          return
        }
        this.sftpSession = sftp
        const drop = (): void => {
          if (this.sftpSession === sftp) {
            this.sftpSession = null
          }
        }
        sftp.on('close', drop)
        sftp.on('end', drop)
        resolvePromise(sftp)
      })
    })

    return this.sftpOpening
  }
}
