import type { SshManagerApi } from '../../../electron/preload/index'

declare global {
  interface Window {
    api: SshManagerApi
  }
}

export {}
