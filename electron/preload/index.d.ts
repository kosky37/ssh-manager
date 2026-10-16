import type { SshManagerApi } from './index'

declare global {
  interface Window {
    api: SshManagerApi
  }
}

export {}
