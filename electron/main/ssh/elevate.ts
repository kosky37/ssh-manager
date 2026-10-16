import type { SshSession } from './session'
import type { ExecResult } from '../types'

export function isRootUser(session: SshSession): boolean {
  return session.config.username === 'root'
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

/** Non-interactive sudo that prefers the stored SSH password when available. */
export function sudoPrefix(session: SshSession): string {
  if (isRootUser(session)) return ''
  const password = session.config.password
  if (password) {
    return `printf '%s\\n' ${shellQuote(password)} | sudo -S -p '' `
  }
  return 'sudo -n '
}

export async function sudoExec(
  session: SshSession,
  command: string,
  timeoutMs?: number
): Promise<ExecResult> {
  const prefix = sudoPrefix(session)
  return session.exec(`${prefix}${command}`, timeoutMs)
}
