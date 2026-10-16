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
} from '../../../electron/preload/index'

export type TabId = 'terminal' | 'docker' | 'tailscale' | 'resources' | 'files'

export interface TerminalSpec {
  id: string
  title: string
  su: boolean
  command?: string
  cwd?: string
}

export type OpenTerminal = (spec: Omit<TerminalSpec, 'id' | 'su'> & { su?: boolean }) => void
