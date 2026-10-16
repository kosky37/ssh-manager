import { app, shell, BrowserWindow, ipcMain, dialog, nativeImage } from 'electron'
import { basename, join } from 'path'
import { mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { ClientChannel } from 'ssh2'
import icon from '../../resources/icon.png?asset'
import { sessionManager } from './ssh/manager'
import * as docker from './ssh/docker'
import * as tailscale from './ssh/tailscale'
import * as system from './ssh/system'
import * as files from './ssh/files'
import type { ServerConfig } from './types'

const dragIcon = nativeImage.createFromPath(icon).resize({ width: 32, height: 32 })

const shells = new Map<string, ClientChannel>()

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    title: 'SSH Manager',
    icon,
    autoHideMenuBar: true,
    backgroundColor: '#0e1210',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('servers:list', () => {
    return sessionManager.getServers().map((s) => ({
      ...s,
      password: s.password ? '••••••' : undefined,
      connected: sessionManager.isConnected(s.id)
    }))
  })

  ipcMain.handle('servers:save', (_e, servers: ServerConfig[]) => {
    const existing = sessionManager.getServers()
    const merged = servers.map((s) => {
      const prev = existing.find((p) => p.id === s.id)
      if (s.password === '••••••' && prev?.password) {
        return { ...s, password: prev.password }
      }
      return s
    })
    sessionManager.saveServers(merged)
    return true
  })

  ipcMain.handle('servers:connect', async (_e, serverId: string) => {
    return sessionManager.connect(serverId)
  })

  ipcMain.handle('servers:disconnect', (_e, serverId: string) => {
    const shellKey = [...shells.keys()].filter((k) => k.startsWith(`${serverId}:`))
    for (const key of shellKey) {
      shells.get(key)?.close()
      shells.delete(key)
    }
    sessionManager.disconnect(serverId)
    return true
  })

  ipcMain.handle(
    'terminal:open',
    async (
      _e,
      serverId: string,
      termId: string,
      opts: { cols: number; rows: number; su: boolean }
    ) => {
      const session = sessionManager.getSession(serverId)
      const stream = await session.shell(opts.cols, opts.rows)
      const key = `${serverId}:${termId}`
      shells.set(key, stream)

      const win = BrowserWindow.getAllWindows()[0]

      stream.on('data', (data: Buffer) => {
        win?.webContents.send('terminal:data', { termId, data: data.toString('base64') })
      })

      stream.on('close', () => {
        // Only clear if this stream still owns the slot — a remount can open a
        // new shell under the same key before the old close event arrives.
        if (shells.get(key) === stream) {
          shells.delete(key)
          win?.webContents.send('terminal:closed', { termId })
        }
      })

      if (opts.su && session.config.username !== 'root') {
        // Elevate to root; feed stored password when sudo asks for it.
        let pendingPassword = session.config.password || ''
        let passwordSent = false
        const onPrompt = (data: Buffer) => {
          if (passwordSent || !pendingPassword) return
          const text = data.toString('utf8').toLowerCase()
          if (
            text.includes('password') ||
            text.includes('[sudo]') ||
            text.includes('passwort')
          ) {
            passwordSent = true
            stream.write(`${pendingPassword}\n`)
            pendingPassword = ''
            stream.removeListener('data', onPrompt)
          }
        }
        stream.on('data', onPrompt)
        stream.write('sudo -i\n')
        // Stop watching after a short window if no prompt appeared.
        setTimeout(() => {
          stream.removeListener('data', onPrompt)
          pendingPassword = ''
        }, 8000)
      }

      return { ok: true }
    }
  )

  ipcMain.on('terminal:input', (_e, payload: { termId: string; data: string }) => {
    for (const [key, stream] of shells) {
      if (key.endsWith(`:${payload.termId}`)) {
        stream.write(Buffer.from(payload.data, 'base64'))
        break
      }
    }
  })

  ipcMain.on(
    'terminal:resize',
    (_e, payload: { termId: string; cols: number; rows: number }) => {
      for (const [key, stream] of shells) {
        if (key.endsWith(`:${payload.termId}`)) {
          stream.setWindow(payload.rows, payload.cols, 0, 0)
          break
        }
      }
    }
  )

  ipcMain.handle('terminal:close', (_e, termId: string) => {
    for (const [key, stream] of shells) {
      if (key.endsWith(`:${termId}`)) {
        stream.close()
        shells.delete(key)
        break
      }
    }
    return true
  })

  ipcMain.handle('docker:list', async (_e, serverId: string) => {
    return docker.listContainers(sessionManager.getSession(serverId))
  })

  ipcMain.handle('docker:stats', async (_e, serverId: string) => {
    return docker.containerStats(sessionManager.getSession(serverId))
  })

  ipcMain.handle(
    'docker:logs',
    async (_e, serverId: string, containerId: string, lines?: number) => {
      return docker.containerLogs(sessionManager.getSession(serverId), containerId, lines)
    }
  )

  ipcMain.handle(
    'docker:inspect',
    async (_e, serverId: string, containerId: string) => {
      return docker.containerInspect(sessionManager.getSession(serverId), containerId)
    }
  )

  ipcMain.handle(
    'docker:action',
    async (
      _e,
      serverId: string,
      containerId: string,
      action: 'start' | 'stop' | 'restart' | 'remove'
    ) => {
      return docker.containerAction(sessionManager.getSession(serverId), containerId, action)
    }
  )

  ipcMain.handle('tailscale:status', async (_e, serverId: string) => {
    return tailscale.getTailscaleStatus(sessionManager.getSession(serverId))
  })

  ipcMain.handle('tailscale:install', async (_e, serverId: string) => {
    return tailscale.installTailscale(sessionManager.getSession(serverId))
  })

  ipcMain.handle('tailscale:update', async (_e, serverId: string) => {
    return tailscale.updateTailscale(sessionManager.getSession(serverId))
  })

  ipcMain.handle(
    'tailscale:set',
    async (
      _e,
      serverId: string,
      setting: 'accept-routes' | 'accept-dns' | 'ssh' | 'advertise-exit-node',
      enabled: boolean
    ) => {
      return tailscale.setTailscaleSetting(
        sessionManager.getSession(serverId),
        setting,
        enabled
      )
    }
  )

  ipcMain.handle('tailscale:up', async (_e, serverId: string, authKey?: string) => {
    return tailscale.tailscaleUp(sessionManager.getSession(serverId), authKey)
  })

  ipcMain.handle('tailscale:down', async (_e, serverId: string) => {
    return tailscale.tailscaleDown(sessionManager.getSession(serverId))
  })

  ipcMain.handle('system:resources', async (_e, serverId: string) => {
    return system.getSystemResources(sessionManager.getSession(serverId))
  })

  ipcMain.handle('files:list', async (_e, serverId: string, path: string) => {
    return files.listDirectory(sessionManager.getSession(serverId), path)
  })

  ipcMain.handle('files:accounts', async (_e, serverId: string) => {
    return files.listAccounts(sessionManager.getSession(serverId))
  })

  ipcMain.handle('files:home', async (_e, serverId: string) => {
    return files.resolveHome(sessionManager.getSession(serverId))
  })

  ipcMain.handle(
    'files:chmod',
    async (_e, serverId: string, path: string, mode: string) => {
      return files.chmod(sessionManager.getSession(serverId), path, mode)
    }
  )

  ipcMain.handle(
    'files:chown',
    async (_e, serverId: string, path: string, owner: string, group?: string) => {
      return files.chown(sessionManager.getSession(serverId), path, owner, group)
    }
  )

  ipcMain.handle('files:mkdir', async (_e, serverId: string, path: string) => {
    return files.mkdir(sessionManager.getSession(serverId), path)
  })

  ipcMain.handle('files:remove', async (_e, serverId: string, path: string) => {
    return files.removePath(sessionManager.getSession(serverId), path)
  })

  ipcMain.handle(
    'files:copy',
    async (_e, serverId: string, sourcePath: string, destDir: string) => {
      return files.copyPath(sessionManager.getSession(serverId), sourcePath, destDir)
    }
  )

  ipcMain.handle(
    'files:move',
    async (_e, serverId: string, sourcePath: string, destDir: string) => {
      return files.movePath(sessionManager.getSession(serverId), sourcePath, destDir)
    }
  )

  ipcMain.handle('files:download', async (_e, serverId: string, remotePath: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: remotePath.split('/').pop() || 'download'
    })
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true }
    }
    await files.downloadFile(sessionManager.getSession(serverId), remotePath, result.filePath)
    return { ok: true, localPath: result.filePath }
  })

  ipcMain.handle('files:downloadTemp', async (_e, serverId: string, remotePath: string) => {
    const dir = join(tmpdir(), 'ssh-manager-drag')
    mkdirSync(dir, { recursive: true })
    const localPath = join(dir, basename(remotePath) || 'download')
    await files.downloadFile(sessionManager.getSession(serverId), remotePath, localPath)
    return { ok: true, localPath }
  })

  ipcMain.handle('files:upload', async (_e, serverId: string, remoteDir: string) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true }
    }
    const session = sessionManager.getSession(serverId)
    for (const local of result.filePaths) {
      await files.uploadFile(session, local, remoteDir.endsWith('/') ? remoteDir : remoteDir + '/')
    }
    return { ok: true, count: result.filePaths.length }
  })

  ipcMain.handle(
    'files:uploadPaths',
    async (_e, serverId: string, remoteDir: string, localPaths: string[]) => {
      if (!localPaths?.length) return { ok: false, canceled: true }
      const session = sessionManager.getSession(serverId)
      const dest = remoteDir.endsWith('/') ? remoteDir : remoteDir + '/'
      for (const local of localPaths) {
        await files.uploadFile(session, local, dest)
      }
      return { ok: true, count: localPaths.length }
    }
  )

  ipcMain.on('files:start-drag', (event, localPath: string) => {
    if (!localPath) return
    event.sender.startDrag({
      file: localPath,
      icon: dragIcon
    })
  })

  ipcMain.on(
    'files:drag-out',
    async (event, serverId: string, remotePath: string) => {
      try {
        const dir = join(tmpdir(), 'ssh-manager-drag')
        mkdirSync(dir, { recursive: true })
        const localPath = join(dir, basename(remotePath) || 'download')
        await files.downloadFile(sessionManager.getSession(serverId), remotePath, localPath)
        event.sender.startDrag({
          file: localPath,
          icon: dragIcon
        })
      } catch {
        // Drag cancelled or download failed; renderer shows status separately.
      }
    }
  )
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.ssh-manager.app')
  }
  sessionManager.loadServers()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  sessionManager.disconnectAll()
  if (process.platform !== 'darwin') app.quit()
})
