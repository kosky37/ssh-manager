import { app, shell, BrowserWindow, ipcMain, dialog, Menu, nativeImage, screen } from 'electron'
import { basename, join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { ClientChannel } from 'ssh2'
import icon from '../../resources/icon.png?asset'
import { sessionManager } from './ssh/manager'
import { shellQuote } from './ssh/elevate'
import * as docker from './ssh/docker'
import * as tailscale from './ssh/tailscale'
import * as system from './ssh/system'
import * as files from './ssh/files'
import type { ServerInput } from './types'

app.setPath('userData', join(app.getPath('appData'), 'ssh-manager'))

const dragIcon = nativeImage.createFromPath(icon).resize({ width: 32, height: 32 })

interface ShellEntry {
  serverId: string
  stream: ClientChannel
}

const shells = new Map<string, ShellEntry>()
let mainWindow: BrowserWindow | null = null

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

function windowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function loadWindowState(): WindowState {
  const fallback: WindowState = { width: 1400, height: 900, maximized: false }
  try {
    const path = windowStatePath()
    if (!existsSync(path)) return fallback
    const state = { ...fallback, ...JSON.parse(readFileSync(path, 'utf-8')) } as WindowState
    if (state.x !== undefined && state.y !== undefined) {
      const visible = screen.getAllDisplays().some(({ workArea: a }) => {
        return (
          state.x! < a.x + a.width - 100 &&
          state.x! + state.width > a.x + 100 &&
          state.y! >= a.y - 10 &&
          state.y! < a.y + a.height - 100
        )
      })
      if (!visible) {
        delete state.x
        delete state.y
      }
    }
    return state
  } catch {
    return fallback
  }
}

function saveWindowState(win: BrowserWindow): void {
  try {
    const bounds = win.getNormalBounds()
    const state: WindowState = { ...bounds, maximized: win.isMaximized() }
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(windowStatePath(), JSON.stringify(state), 'utf-8')
  } catch {
    return
  }
}

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function createWindow(): void {
  const state = loadWindowState()
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 900,
    minHeight: 600,
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
  mainWindow = win
  win.setMenuBarVisibility(false)

  win.on('ready-to-show', () => {
    if (state.maximized) win.maximize()
    win.show()
  })

  win.on('close', () => saveWindowState(win))
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.webContents.setWindowOpenHandler((details) => {
    if (/^https?:\/\//i.test(details.url)) shell.openExternal(details.url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    }
  })

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const key = input.key.toLowerCase()
    if ((input.control || input.meta) && input.shift && key === 'i') {
      win.webContents.toggleDevTools()
      event.preventDefault()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function closeShellsFor(serverId: string): void {
  for (const [termId, entry] of shells) {
    if (entry.serverId === serverId) {
      shells.delete(termId)
      entry.stream.close()
      send('terminal:closed', { termId })
    }
  }
}

function registerIpc(): void {
  sessionManager.on('status', (payload: { serverId: string; connected: boolean; lost?: boolean }) => {
    if (!payload.connected) closeShellsFor(payload.serverId)
    send('servers:status', payload)
  })

  sessionManager.on('changed', () => {
    send('servers:changed', null)
  })

  ipcMain.handle('servers:list', () => sessionManager.listInfo())

  ipcMain.handle('servers:upsert', (_e, input: ServerInput) => sessionManager.upsert(input))

  ipcMain.handle('servers:remove', (_e, serverId: string) => {
    sessionManager.remove(serverId)
    return true
  })

  ipcMain.handle('servers:reorder', (_e, ids: string[]) => {
    sessionManager.reorder(ids)
    return true
  })

  ipcMain.handle('servers:test', (_e, input: ServerInput) => sessionManager.test(input))

  ipcMain.handle('servers:import', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import servers',
      filters: [{ name: 'Server list', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false, count: 0 }
    const count = sessionManager.importFrom(result.filePaths[0])
    return { ok: count > 0, count }
  })

  ipcMain.handle('servers:openConfigDir', () => {
    shell.showItemInFolder(sessionManager.configFile)
    return true
  })

  ipcMain.handle('servers:pickKey', async () => {
    const sshDir = join(app.getPath('home'), '.ssh')
    const result = await dialog.showOpenDialog({
      title: 'Select private key',
      defaultPath: existsSync(sshDir) ? sshDir : app.getPath('home'),
      properties: ['openFile', 'showHiddenFiles']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('servers:connect', async (_e, serverId: string) => {
    return sessionManager.connect(serverId)
  })

  ipcMain.handle('servers:disconnect', (_e, serverId: string) => {
    closeShellsFor(serverId)
    sessionManager.disconnect(serverId)
    return true
  })

  ipcMain.handle(
    'terminal:open',
    async (
      _e,
      serverId: string,
      termId: string,
      opts: { cols: number; rows: number; su: boolean; command?: string; cwd?: string }
    ) => {
      const session = sessionManager.getSession(serverId)
      const stream = await session.shell(opts.cols, opts.rows)
      shells.set(termId, { serverId, stream })

      stream.on('data', (data: Buffer) => {
        send('terminal:data', { termId, data: data.toString('base64') })
      })

      stream.on('close', () => {
        if (shells.get(termId)?.stream === stream) {
          shells.delete(termId)
          send('terminal:closed', { termId })
        }
      })

      const followUp = [
        opts.cwd ? `cd ${shellQuote(opts.cwd)}` : '',
        opts.command || ''
      ]
        .filter(Boolean)
        .join(' && ')

      let followUpSent = false
      const sendFollowUp = (delay: number): void => {
        if (followUpSent || !followUp) return
        followUpSent = true
        setTimeout(() => {
          if (shells.get(termId)?.stream === stream) stream.write(`${followUp}\n`)
        }, delay)
      }

      if (opts.su && session.config.username !== 'root') {
        let pendingPassword = session.config.password || ''
        let passwordSent = false
        const onPrompt = (data: Buffer): void => {
          if (passwordSent || !pendingPassword) return
          const text = data.toString('utf8').toLowerCase()
          if (text.includes('password') || text.includes('[sudo]') || text.includes('passwort')) {
            passwordSent = true
            stream.write(`${pendingPassword}\n`)
            pendingPassword = ''
            stream.removeListener('data', onPrompt)
            sendFollowUp(600)
          }
        }
        stream.on('data', onPrompt)
        stream.write('sudo -i\n')
        setTimeout(() => sendFollowUp(0), 2500)
        setTimeout(() => {
          stream.removeListener('data', onPrompt)
          pendingPassword = ''
        }, 8000)
      } else {
        sendFollowUp(150)
      }

      return { ok: true }
    }
  )

  ipcMain.on('terminal:input', (_e, payload: { termId: string; data: string }) => {
    shells.get(payload.termId)?.stream.write(Buffer.from(payload.data, 'base64'))
  })

  ipcMain.on('terminal:resize', (_e, payload: { termId: string; cols: number; rows: number }) => {
    shells.get(payload.termId)?.stream.setWindow(payload.rows, payload.cols, 0, 0)
  })

  ipcMain.handle('terminal:close', (_e, termId: string) => {
    const entry = shells.get(termId)
    if (entry) {
      shells.delete(termId)
      entry.stream.close()
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

  ipcMain.handle('docker:inspect', async (_e, serverId: string, containerId: string) => {
    return docker.containerInspect(sessionManager.getSession(serverId), containerId)
  })

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
      return tailscale.setTailscaleSetting(sessionManager.getSession(serverId), setting, enabled)
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

  ipcMain.handle('files:chmod', async (_e, serverId: string, path: string, mode: string) => {
    return files.chmod(sessionManager.getSession(serverId), path, mode)
  })

  ipcMain.handle(
    'files:chown',
    async (_e, serverId: string, path: string, owner: string, group?: string) => {
      return files.chown(sessionManager.getSession(serverId), path, owner, group)
    }
  )

  ipcMain.handle('files:mkdir', async (_e, serverId: string, path: string) => {
    return files.mkdir(sessionManager.getSession(serverId), path)
  })

  ipcMain.handle('files:touch', async (_e, serverId: string, path: string) => {
    return files.writeEmptyFile(sessionManager.getSession(serverId), path)
  })

  ipcMain.handle('files:remove', async (_e, serverId: string, path: string) => {
    return files.removePath(sessionManager.getSession(serverId), path)
  })

  ipcMain.handle(
    'files:rename',
    async (_e, serverId: string, sourcePath: string, targetPath: string) => {
      return files.renamePath(sessionManager.getSession(serverId), sourcePath, targetPath)
    }
  )

  ipcMain.handle('files:copy', async (_e, serverId: string, sourcePath: string, destDir: string) => {
    return files.copyPath(sessionManager.getSession(serverId), sourcePath, destDir)
  })

  ipcMain.handle('files:move', async (_e, serverId: string, sourcePath: string, destDir: string) => {
    return files.movePath(sessionManager.getSession(serverId), sourcePath, destDir)
  })

  ipcMain.handle('files:download', async (_e, serverId: string, remotePath: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: join(app.getPath('downloads'), remotePath.split('/').pop() || 'download')
    })
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true }
    }
    await files.downloadFile(sessionManager.getSession(serverId), remotePath, result.filePath)
    return { ok: true, localPath: result.filePath }
  })

  ipcMain.handle('files:showLocal', (_e, localPath: string) => {
    shell.showItemInFolder(localPath)
    return true
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

  ipcMain.on('files:drag-out', async (event, serverId: string, remotePath: string) => {
    try {
      const dir = join(tmpdir(), 'ssh-manager-drag')
      mkdirSync(dir, { recursive: true })
      const localPath = join(dir, basename(remotePath) || 'download')
      await files.downloadFile(sessionManager.getSession(serverId), remotePath, localPath)
      event.sender.startDrag({ file: localPath, icon: dragIcon })
    } catch {
      return
    }
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.kosky37.ssh-manager')
    }
    Menu.setApplicationMenu(null)
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
}
