import { clipboard, contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  DiskUsage,
  DockerContainer,
  DockerInspect,
  DockerStats,
  FileEntry,
  NamedAccount,
  OpResult,
  ProcessInfo,
  ServerInfo,
  ServerInput,
  SystemResources,
  TailscalePrefs,
  TailscaleStatus
} from '../main/types'

export type {
  DiskUsage,
  DockerContainer,
  DockerInspect,
  DockerStats,
  FileEntry,
  NamedAccount,
  OpResult,
  ProcessInfo,
  ServerInfo,
  ServerInput,
  SystemResources,
  TailscalePrefs,
  TailscaleStatus
}

type ConnectResult = { ok: true } | { ok: false; error: string }
type TailscaleSetting = 'accept-routes' | 'accept-dns' | 'ssh' | 'advertise-exit-node'
type DockerAction = 'start' | 'stop' | 'restart' | 'remove'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  servers: {
    list: (): Promise<ServerInfo[]> => ipcRenderer.invoke('servers:list'),
    upsert: (input: ServerInput): Promise<ServerInfo> => ipcRenderer.invoke('servers:upsert', input),
    remove: (serverId: string): Promise<boolean> => ipcRenderer.invoke('servers:remove', serverId),
    reorder: (ids: string[]): Promise<boolean> => ipcRenderer.invoke('servers:reorder', ids),
    test: (input: ServerInput): Promise<ConnectResult> => ipcRenderer.invoke('servers:test', input),
    import: (): Promise<{ ok: boolean; count: number }> => ipcRenderer.invoke('servers:import'),
    openConfigDir: (): Promise<boolean> => ipcRenderer.invoke('servers:openConfigDir'),
    pickKey: (): Promise<string | null> => ipcRenderer.invoke('servers:pickKey'),
    connect: (serverId: string): Promise<ConnectResult> =>
      ipcRenderer.invoke('servers:connect', serverId),
    disconnect: (serverId: string): Promise<boolean> =>
      ipcRenderer.invoke('servers:disconnect', serverId),
    onStatus: (cb: (payload: { serverId: string; connected: boolean; lost?: boolean }) => void) =>
      subscribe('servers:status', cb),
    onChanged: (cb: () => void) => subscribe('servers:changed', cb)
  },
  terminal: {
    open: (
      serverId: string,
      termId: string,
      opts: { cols: number; rows: number; su: boolean; command?: string; cwd?: string }
    ): Promise<{ ok: boolean }> => ipcRenderer.invoke('terminal:open', serverId, termId, opts),
    input: (termId: string, data: string) => ipcRenderer.send('terminal:input', { termId, data }),
    resize: (termId: string, cols: number, rows: number) =>
      ipcRenderer.send('terminal:resize', { termId, cols, rows }),
    close: (termId: string): Promise<boolean> => ipcRenderer.invoke('terminal:close', termId),
    onData: (cb: (payload: { termId: string; data: string }) => void) =>
      subscribe('terminal:data', cb),
    onClosed: (cb: (payload: { termId: string }) => void) => subscribe('terminal:closed', cb)
  },
  docker: {
    list: (
      serverId: string
    ): Promise<{ available: boolean; containers: DockerContainer[]; error?: string }> =>
      ipcRenderer.invoke('docker:list', serverId),
    stats: (serverId: string): Promise<DockerStats[]> => ipcRenderer.invoke('docker:stats', serverId),
    logs: (serverId: string, containerId: string, lines?: number): Promise<string> =>
      ipcRenderer.invoke('docker:logs', serverId, containerId, lines),
    inspect: (serverId: string, containerId: string): Promise<DockerInspect | null> =>
      ipcRenderer.invoke('docker:inspect', serverId, containerId),
    action: (serverId: string, containerId: string, action: DockerAction): Promise<OpResult> =>
      ipcRenderer.invoke('docker:action', serverId, containerId, action)
  },
  tailscale: {
    status: (serverId: string): Promise<TailscaleStatus> =>
      ipcRenderer.invoke('tailscale:status', serverId),
    install: (serverId: string): Promise<OpResult> => ipcRenderer.invoke('tailscale:install', serverId),
    update: (serverId: string): Promise<OpResult> => ipcRenderer.invoke('tailscale:update', serverId),
    set: (serverId: string, setting: TailscaleSetting, enabled: boolean): Promise<OpResult> =>
      ipcRenderer.invoke('tailscale:set', serverId, setting, enabled),
    up: (serverId: string, authKey?: string): Promise<OpResult> =>
      ipcRenderer.invoke('tailscale:up', serverId, authKey),
    down: (serverId: string): Promise<OpResult> => ipcRenderer.invoke('tailscale:down', serverId)
  },
  system: {
    resources: (serverId: string): Promise<SystemResources> =>
      ipcRenderer.invoke('system:resources', serverId)
  },
  files: {
    list: (serverId: string, path: string): Promise<FileEntry[]> =>
      ipcRenderer.invoke('files:list', serverId, path),
    accounts: (serverId: string): Promise<{ users: NamedAccount[]; groups: NamedAccount[] }> =>
      ipcRenderer.invoke('files:accounts', serverId),
    home: (serverId: string): Promise<string> => ipcRenderer.invoke('files:home', serverId),
    chmod: (serverId: string, path: string, mode: string): Promise<OpResult> =>
      ipcRenderer.invoke('files:chmod', serverId, path, mode),
    chown: (serverId: string, path: string, owner: string, group?: string): Promise<OpResult> =>
      ipcRenderer.invoke('files:chown', serverId, path, owner, group),
    mkdir: (serverId: string, path: string): Promise<OpResult> =>
      ipcRenderer.invoke('files:mkdir', serverId, path),
    touch: (serverId: string, path: string): Promise<OpResult> =>
      ipcRenderer.invoke('files:touch', serverId, path),
    remove: (serverId: string, path: string): Promise<OpResult> =>
      ipcRenderer.invoke('files:remove', serverId, path),
    rename: (serverId: string, sourcePath: string, targetPath: string): Promise<OpResult> =>
      ipcRenderer.invoke('files:rename', serverId, sourcePath, targetPath),
    copy: (serverId: string, sourcePath: string, destDir: string): Promise<OpResult> =>
      ipcRenderer.invoke('files:copy', serverId, sourcePath, destDir),
    move: (serverId: string, sourcePath: string, destDir: string): Promise<OpResult> =>
      ipcRenderer.invoke('files:move', serverId, sourcePath, destDir),
    download: (
      serverId: string,
      remotePath: string
    ): Promise<{ ok: true; localPath: string } | { ok: false; canceled: true }> =>
      ipcRenderer.invoke('files:download', serverId, remotePath),
    showLocal: (localPath: string): Promise<boolean> =>
      ipcRenderer.invoke('files:showLocal', localPath),
    upload: (
      serverId: string,
      remoteDir: string
    ): Promise<{ ok: true; count: number } | { ok: false; canceled: true }> =>
      ipcRenderer.invoke('files:upload', serverId, remoteDir),
    uploadPaths: (
      serverId: string,
      remoteDir: string,
      localPaths: string[]
    ): Promise<{ ok: true; count: number } | { ok: false; canceled: true }> =>
      ipcRenderer.invoke('files:uploadPaths', serverId, remoteDir, localPaths),
    dragOut: (serverId: string, remotePath: string) =>
      ipcRenderer.send('files:drag-out', serverId, remotePath),
    getPathForFile: (file: File) => webUtils.getPathForFile(file)
  },
  clipboard: {
    readText: (): string => clipboard.readText(),
    writeText: (text: string): void => clipboard.writeText(text)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type SshManagerApi = typeof api
