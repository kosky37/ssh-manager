import { contextBridge, ipcRenderer, webUtils } from 'electron'

export interface ServerConfig {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey'
  password?: string
  privateKeyPath?: string
  passphrase?: string
}

const api = {
  servers: {
    list: () => ipcRenderer.invoke('servers:list'),
    save: (servers: ServerConfig[]) => ipcRenderer.invoke('servers:save', servers),
    connect: (serverId: string) => ipcRenderer.invoke('servers:connect', serverId),
    disconnect: (serverId: string) => ipcRenderer.invoke('servers:disconnect', serverId)
  },
  terminal: {
    open: (
      serverId: string,
      termId: string,
      opts: { cols: number; rows: number; su: boolean }
    ) => ipcRenderer.invoke('terminal:open', serverId, termId, opts),
    input: (termId: string, data: string) =>
      ipcRenderer.send('terminal:input', { termId, data }),
    resize: (termId: string, cols: number, rows: number) =>
      ipcRenderer.send('terminal:resize', { termId, cols, rows }),
    close: (termId: string) => ipcRenderer.invoke('terminal:close', termId),
    onData: (cb: (payload: { termId: string; data: string }) => void) => {
      const listener = (_: unknown, payload: { termId: string; data: string }) => cb(payload)
      ipcRenderer.on('terminal:data', listener)
      return () => ipcRenderer.removeListener('terminal:data', listener)
    },
    onClosed: (cb: (payload: { termId: string }) => void) => {
      const listener = (_: unknown, payload: { termId: string }) => cb(payload)
      ipcRenderer.on('terminal:closed', listener)
      return () => ipcRenderer.removeListener('terminal:closed', listener)
    }
  },
  docker: {
    list: (serverId: string) => ipcRenderer.invoke('docker:list', serverId),
    stats: (serverId: string) => ipcRenderer.invoke('docker:stats', serverId),
    logs: (serverId: string, containerId: string, lines?: number) =>
      ipcRenderer.invoke('docker:logs', serverId, containerId, lines),
    inspect: (serverId: string, containerId: string) =>
      ipcRenderer.invoke('docker:inspect', serverId, containerId),
    action: (
      serverId: string,
      containerId: string,
      action: 'start' | 'stop' | 'restart' | 'remove'
    ) => ipcRenderer.invoke('docker:action', serverId, containerId, action)
  },
  tailscale: {
    status: (serverId: string) => ipcRenderer.invoke('tailscale:status', serverId),
    install: (serverId: string) => ipcRenderer.invoke('tailscale:install', serverId),
    update: (serverId: string) => ipcRenderer.invoke('tailscale:update', serverId),
    set: (
      serverId: string,
      setting: 'accept-routes' | 'accept-dns' | 'ssh' | 'advertise-exit-node',
      enabled: boolean
    ) => ipcRenderer.invoke('tailscale:set', serverId, setting, enabled),
    up: (serverId: string, authKey?: string) =>
      ipcRenderer.invoke('tailscale:up', serverId, authKey),
    down: (serverId: string) => ipcRenderer.invoke('tailscale:down', serverId)
  },
  system: {
    resources: (serverId: string) => ipcRenderer.invoke('system:resources', serverId)
  },
  files: {
    list: (serverId: string, path: string) => ipcRenderer.invoke('files:list', serverId, path),
    accounts: (serverId: string) => ipcRenderer.invoke('files:accounts', serverId),
    home: (serverId: string) => ipcRenderer.invoke('files:home', serverId),
    chmod: (serverId: string, path: string, mode: string) =>
      ipcRenderer.invoke('files:chmod', serverId, path, mode),
    chown: (serverId: string, path: string, owner: string, group?: string) =>
      ipcRenderer.invoke('files:chown', serverId, path, owner, group),
    mkdir: (serverId: string, path: string) => ipcRenderer.invoke('files:mkdir', serverId, path),
    remove: (serverId: string, path: string) =>
      ipcRenderer.invoke('files:remove', serverId, path),
    copy: (serverId: string, sourcePath: string, destDir: string) =>
      ipcRenderer.invoke('files:copy', serverId, sourcePath, destDir),
    move: (serverId: string, sourcePath: string, destDir: string) =>
      ipcRenderer.invoke('files:move', serverId, sourcePath, destDir),
    download: (serverId: string, remotePath: string) =>
      ipcRenderer.invoke('files:download', serverId, remotePath),
    downloadTemp: (serverId: string, remotePath: string) =>
      ipcRenderer.invoke('files:downloadTemp', serverId, remotePath),
    upload: (serverId: string, remoteDir: string) =>
      ipcRenderer.invoke('files:upload', serverId, remoteDir),
    uploadPaths: (serverId: string, remoteDir: string, localPaths: string[]) =>
      ipcRenderer.invoke('files:uploadPaths', serverId, remoteDir, localPaths),
    startDrag: (localPath: string) => ipcRenderer.send('files:start-drag', localPath),
    dragOut: (serverId: string, remotePath: string) =>
      ipcRenderer.send('files:drag-out', serverId, remotePath),
    getPathForFile: (file: File) => webUtils.getPathForFile(file)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type SshManagerApi = typeof api
