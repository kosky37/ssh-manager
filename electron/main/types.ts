export type AuthType = 'password' | 'privateKey'

export interface ServerConfig {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: AuthType
  password?: string
  privateKeyPath?: string
  passphrase?: string
}

export interface ExecResult {
  stdout: string
  stderr: string
  code: number | null
}

export interface NamedAccount {
  id: string
  name: string
}

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink' | 'other'
  size: number
  /** Symbolic mode, e.g. drwxr-xr-x */
  mode: string
  /** Octal permission bits without type, e.g. 755 */
  modeOctal: string
  /** Resolved username when available */
  owner: string
  /** Resolved group name when available */
  group: string
  /** Numeric uid from SFTP attrs */
  uid: string
  /** Numeric gid from SFTP attrs */
  gid: string
  mtime: string
}

export interface DockerContainer {
  id: string
  name: string
  image: string
  status: string
  state: string
  ports: string
}

export interface DockerStats {
  id: string
  name: string
  cpu: string
  memUsage: string
  memPerc: string
  netIO: string
  blockIO: string
}

export interface DockerInspect {
  id: string
  created: string
  startedAt: string
  finishedAt: string
  image: string
  command: string
  restartPolicy: string
  networks: string
  mounts: string
  platform: string
  sizeRw: string
  sizeRootFs: string
}

export interface SystemResources {
  hostname: string
  uptime: string
  loadAvg: string
  cpuModel: string
  cpuCores: string
  memTotal: string
  memUsed: string
  memAvailable: string
  swapTotal: string
  swapUsed: string
  disk: string
  topProcesses: string
}

export interface TailscaleStatus {
  installed: boolean
  version: string | null
  statusJson: string | null
  rawStatus: string | null
  error?: string
}

export type SessionTab =
  | 'terminal'
  | 'docker'
  | 'tailscale'
  | 'resources'
  | 'files'
