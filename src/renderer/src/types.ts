export interface ServerInfo {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey'
  connected?: boolean
}

export type TabId = 'terminal' | 'docker' | 'tailscale' | 'resources' | 'files'
