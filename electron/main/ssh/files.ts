import { createWriteStream, createReadStream } from 'fs'
import { basename, posix } from 'path'
import type { SshSession } from './session'
import type { FileEntry, NamedAccount } from '../types'

type IdMaps = {
  users: Map<string, string>
  groups: Map<string, string>
  userList: NamedAccount[]
  groupList: NamedAccount[]
}

const idMaps = new WeakMap<SshSession, Promise<IdMaps>>()

function modeToString(mode: number): string {
  const type =
    (mode & 0o170000) === 0o040000
      ? 'd'
      : (mode & 0o170000) === 0o120000
        ? 'l'
        : '-'
  const perms = [6, 3, 0]
    .map((shift) => {
      const part = (mode >> shift) & 0o7
      return (
        (part & 4 ? 'r' : '-') +
        (part & 2 ? 'w' : '-') +
        (part & 1 ? 'x' : '-')
      )
    })
    .join('')
  return type + perms
}

function modeToOctal(mode: number): string {
  return ((mode & 0o7777) >>> 0).toString(8)
}

function parseAccounts(text: string): { byId: Map<string, string>; list: NamedAccount[] } {
  const byId = new Map<string, string>()
  const byName = new Map<string, NamedAccount>()

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const parts = trimmed.split(':')
    if (parts.length < 3) continue
    const name = parts[0]
    const id = parts[2]
    if (!name || !id) continue
    if (!byId.has(id)) byId.set(id, name)
    if (!byName.has(name)) byName.set(name, { id, name })
  }

  const list = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  return { byId, list }
}

async function loadIdMaps(session: SshSession): Promise<IdMaps> {
  const existing = idMaps.get(session)
  if (existing) return existing

  const promise = (async () => {
    const [passwd, group] = await Promise.all([
      session.exec('getent passwd 2>/dev/null || cat /etc/passwd 2>/dev/null || true'),
      session.exec('getent group 2>/dev/null || cat /etc/group 2>/dev/null || true')
    ])
    const users = parseAccounts(passwd.stdout)
    const groups = parseAccounts(group.stdout)
    return {
      users: users.byId,
      groups: groups.byId,
      userList: users.list,
      groupList: groups.list
    }
  })()

  idMaps.set(session, promise)
  return promise
}

export async function listAccounts(
  session: SshSession
): Promise<{ users: NamedAccount[]; groups: NamedAccount[] }> {
  const maps = await loadIdMaps(session)
  return { users: maps.userList, groups: maps.groupList }
}

export async function listDirectory(
  session: SshSession,
  remotePath: string
): Promise<FileEntry[]> {
  const sftp = await session.sftp()
  const path = remotePath || '/'
  const maps = await loadIdMaps(session)

  return new Promise((resolvePromise, reject) => {
    sftp.readdir(path, (err, list) => {
      if (err) {
        const message = err.message || String(err)
        reject(new Error(`${message}: ${path}`))
        return
      }

      const entries: FileEntry[] = list.map((item) => {
        const attrs = item.attrs
        const mode = attrs.mode ?? 0
        let type: FileEntry['type'] = 'other'
        if ((mode & 0o170000) === 0o040000) type = 'directory'
        else if ((mode & 0o170000) === 0o100000) type = 'file'
        else if ((mode & 0o170000) === 0o120000) type = 'symlink'

        const uid = String(attrs.uid ?? '')
        const gid = String(attrs.gid ?? '')

        return {
          name: item.filename,
          path: posix.join(path, item.filename),
          type,
          size: attrs.size ?? 0,
          mode: modeToString(mode),
          modeOctal: modeToOctal(mode),
          owner: maps.users.get(uid) || uid,
          group: maps.groups.get(gid) || gid,
          uid,
          gid,
          mtime: attrs.mtime
            ? new Date(attrs.mtime * 1000).toISOString()
            : ''
        }
      })

      entries.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1
        if (a.type !== 'directory' && b.type === 'directory') return 1
        return a.name.localeCompare(b.name)
      })

      resolvePromise(entries)
    })
  })
}

export async function downloadFile(
  session: SshSession,
  remotePath: string,
  localPath: string
): Promise<void> {
  const sftp = await session.sftp()

  return new Promise((resolvePromise, reject) => {
    const write = createWriteStream(localPath)
    const read = sftp.createReadStream(remotePath)
    read.on('error', reject)
    write.on('error', reject)
    write.on('close', () => resolvePromise())
    read.pipe(write)
  })
}

export async function uploadFile(
  session: SshSession,
  localPath: string,
  remotePath: string
): Promise<void> {
  const sftp = await session.sftp()
  const dest = remotePath.endsWith('/')
    ? posix.join(remotePath, basename(localPath))
    : remotePath

  return new Promise((resolvePromise, reject) => {
    const read = createReadStream(localPath)
    const write = sftp.createWriteStream(dest)
    read.on('error', reject)
    write.on('error', reject)
    write.on('close', () => resolvePromise())
    read.pipe(write)
  })
}

export async function chmod(
  session: SshSession,
  remotePath: string,
  mode: string
): Promise<{ ok: boolean; output: string }> {
  const result = await session.exec(
    `chmod ${JSON.stringify(mode)} -- ${JSON.stringify(remotePath)} 2>&1`
  )
  return { ok: result.code === 0, output: (result.stdout || result.stderr).trim() }
}

export async function chown(
  session: SshSession,
  remotePath: string,
  owner: string,
  group?: string
): Promise<{ ok: boolean; output: string }> {
  const spec = group ? `${owner}:${group}` : owner
  const result = await session.exec(
    `chown ${JSON.stringify(spec)} -- ${JSON.stringify(remotePath)} 2>&1`
  )
  return { ok: result.code === 0, output: (result.stdout || result.stderr).trim() }
}

export async function mkdir(
  session: SshSession,
  remotePath: string
): Promise<{ ok: boolean; output: string }> {
  const result = await session.exec(`mkdir -p -- ${JSON.stringify(remotePath)} 2>&1`)
  return { ok: result.code === 0, output: (result.stdout || result.stderr).trim() }
}

export async function removePath(
  session: SshSession,
  remotePath: string
): Promise<{ ok: boolean; output: string }> {
  const result = await session.exec(`rm -rf -- ${JSON.stringify(remotePath)} 2>&1`)
  return { ok: result.code === 0, output: (result.stdout || result.stderr).trim() }
}

export async function copyPath(
  session: SshSession,
  sourcePath: string,
  destDir: string
): Promise<{ ok: boolean; output: string }> {
  const dest = destDir.endsWith('/') ? destDir : `${destDir}/`
  const result = await session.exec(
    `cp -a -- ${JSON.stringify(sourcePath)} ${JSON.stringify(dest)} 2>&1`
  )
  return { ok: result.code === 0, output: (result.stdout || result.stderr).trim() }
}

export async function movePath(
  session: SshSession,
  sourcePath: string,
  destDir: string
): Promise<{ ok: boolean; output: string }> {
  const dest = destDir.endsWith('/') ? destDir : `${destDir}/`
  const result = await session.exec(
    `mv -- ${JSON.stringify(sourcePath)} ${JSON.stringify(dest)} 2>&1`
  )
  return { ok: result.code === 0, output: (result.stdout || result.stderr).trim() }
}

function sftpRealpath(sftp: Awaited<ReturnType<SshSession['sftp']>>, path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    sftp.realpath(path, (err, absPath) => {
      if (err) reject(err)
      else resolvePromise(absPath)
    })
  })
}

function sftpExistsDir(
  sftp: Awaited<ReturnType<SshSession['sftp']>>,
  path: string
): Promise<boolean> {
  return new Promise((resolvePromise) => {
    sftp.stat(path, (err, stats) => {
      resolvePromise(!err && !!stats && stats.isDirectory())
    })
  })
}

/** Resolve a starting directory that SFTP can actually list (shell $HOME often fails in NAS chroots). */
export async function resolveHome(session: SshSession): Promise<string> {
  const sftp = await session.sftp()

  const result = await session.exec('printf %s "$HOME"')
  const shellHome = result.stdout.trim()
  if (shellHome && (await sftpExistsDir(sftp, shellHome))) {
    return shellHome
  }

  try {
    const cwd = await sftpRealpath(sftp, '.')
    if (cwd && (await sftpExistsDir(sftp, cwd))) {
      return cwd
    }
  } catch {
    // fall through
  }

  return '/'
}
