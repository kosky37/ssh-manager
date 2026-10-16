import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink' | 'other'
  size: number
  mode: string
  modeOctal: string
  owner: string
  group: string
  uid: string
  gid: string
  mtime: string
}

interface NamedAccount {
  id: string
  name: string
}

interface Props {
  serverId: string
}

type Triad = { r: boolean; w: boolean; x: boolean }
type PermState = { owner: Triad; group: Triad; others: Triad }

type ClipboardPayload = {
  serverId: string
  path: string
  name: string
  mode: 'copy' | 'cut'
}

type ContextMenuState = {
  x: number
  y: number
  entry: FileEntry | null
}

const EMPTY_TRIAD: Triad = { r: false, w: false, x: false }
const EMPTY_PERMS: PermState = {
  owner: { ...EMPTY_TRIAD },
  group: { ...EMPTY_TRIAD },
  others: { ...EMPTY_TRIAD }
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

function permissionBits(mode: string): string {
  const perms = mode.length >= 10 ? mode.slice(1, 10) : mode
  return perms.length === 9 ? perms : ''
}

function triadFromChunk(chunk: string): Triad {
  return {
    r: chunk[0] === 'r',
    w: chunk[1] === 'w',
    x: chunk[2] === 'x' || chunk[2] === 's' || chunk[2] === 't'
  }
}

function permsFromMode(mode: string): PermState {
  const bits = permissionBits(mode)
  if (bits.length !== 9) return EMPTY_PERMS
  return {
    owner: triadFromChunk(bits.slice(0, 3)),
    group: triadFromChunk(bits.slice(3, 6)),
    others: triadFromChunk(bits.slice(6, 9))
  }
}

function triadValue(t: Triad): number {
  return (t.r ? 4 : 0) + (t.w ? 2 : 0) + (t.x ? 1 : 0)
}

function triadLabel(t: Triad): string {
  return `${t.r ? 'r' : '-'}${t.w ? 'w' : '-'}${t.x ? 'x' : '-'}`
}

function triadTitle(who: string, t: Triad): string {
  const parts: string[] = []
  if (t.r) parts.push('read')
  if (t.w) parts.push('write')
  if (t.x) parts.push('execute')
  return `${who}: ${parts.length ? parts.join(', ') : 'none'}`
}

function octalFromPerms(perms: PermState): string {
  return `${triadValue(perms.owner)}${triadValue(perms.group)}${triadValue(perms.others)}`
}

function ensureOption(list: NamedAccount[], name: string, id: string): NamedAccount[] {
  if (!name) return list
  if (list.some((item) => item.name === name)) return list
  return [{ id: id || name, name }, ...list]
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function FileTypeIcon({ type }: { type: FileEntry['type'] }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    'aria-hidden': true as const
  }

  if (type === 'directory') {
    return (
      <svg {...common} className="file-icon file-icon-dir">
        <path
          d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.2c.3 0 .6.12.8.34L8.2 3.5H13a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V3.5Z"
          fill="currentColor"
          opacity="0.9"
        />
      </svg>
    )
  }

  if (type === 'symlink') {
    return (
      <svg {...common} className="file-icon file-icon-link">
        <path
          d="M6.2 9.8a3.2 3.2 0 0 1 0-4.5l1.4-1.4a3.2 3.2 0 0 1 4.5 4.5l-.7.7"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path
          d="M9.8 6.2a3.2 3.2 0 0 1 0 4.5L8.4 12a3.2 3.2 0 1 1-4.5-4.5l.7-.7"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    )
  }

  return (
    <svg {...common} className="file-icon file-icon-file">
      <path
        d="M4 1.75h5.2L12.5 5v9.25A1 1 0 0 1 11.5 15.25h-7A1 1 0 0 1 3.5 14.25V2.75a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M9.2 1.75V5h3.3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

function PermBadges({ mode }: { mode: string }) {
  const perms = permsFromMode(mode)
  const items: { who: string; short: string; triad: Triad }[] = [
    { who: 'Owner', short: 'U', triad: perms.owner },
    { who: 'Group', short: 'G', triad: perms.group },
    { who: 'Others', short: 'O', triad: perms.others }
  ]

  return (
    <span className="perm-badges">
      {items.map((item) => (
        <span
          key={item.who}
          className={`perm-badge perm-${triadValue(item.triad)}`}
          title={triadTitle(item.who, item.triad)}
        >
          <span className="perm-badge-who">{item.short}</span>
          {triadLabel(item.triad)}
        </span>
      ))}
    </span>
  )
}

function PermCheckboxes({
  perms,
  onChange
}: {
  perms: PermState
  onChange: (next: PermState) => void
}) {
  const rows: { key: keyof PermState; label: string }[] = [
    { key: 'owner', label: 'Owner' },
    { key: 'group', label: 'Group' },
    { key: 'others', label: 'Others' }
  ]

  return (
    <div className="perm-grid">
      {rows.map((row) => (
        <div key={row.key} className="perm-grid-row">
          <span className="perm-grid-label">{row.label}</span>
          {(['r', 'w', 'x'] as const).map((bit) => (
            <label key={bit} className="perm-check">
              <input
                type="checkbox"
                checked={perms[row.key][bit]}
                onChange={(e) =>
                  onChange({
                    ...perms,
                    [row.key]: { ...perms[row.key], [bit]: e.target.checked }
                  })
                }
              />
              {bit === 'r' ? 'Read' : bit === 'w' ? 'Write' : 'Execute'}
            </label>
          ))}
        </div>
      ))}
    </div>
  )
}

export default function FileManagerPanel({ serverId }: Props) {
  const [path, setPath] = useState('/')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [users, setUsers] = useState<NamedAccount[]>([])
  const [groups, setGroups] = useState<NamedAccount[]>([])
  const [selected, setSelected] = useState<FileEntry | null>(null)
  const [perms, setPerms] = useState<PermState>(EMPTY_PERMS)
  const [mode, setMode] = useState('')
  const [owner, setOwner] = useState('')
  const [group, setGroup] = useState('')
  const [rawOwner, setRawOwner] = useState('')
  const [rawGroup, setRawGroup] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [clipboard, setClipboard] = useState<ClipboardPayload | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const listRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<FileEntry | null>(null)
  const pathRef = useRef(path)
  const entriesRef = useRef(entries)
  const clipboardRef = useRef(clipboard)
  const dragDepth = useRef(0)

  selectedRef.current = selected
  pathRef.current = path
  entriesRef.current = entries
  clipboardRef.current = clipboard

  const loadAccounts = useCallback(async () => {
    try {
      const accounts = await window.api.files.accounts(serverId)
      setUsers(accounts.users)
      setGroups(accounts.groups)
    } catch {
      setUsers([])
      setGroups([])
    }
  }, [serverId])

  const load = useCallback(
    async (target: string, keepSelectionPath?: string | null): Promise<boolean> => {
      setBusy(true)
      setError(null)
      try {
        const list = (await window.api.files.list(serverId, target)) as FileEntry[]
        setEntries(list)
        setPath(target)
        setAdvancedOpen(false)
        if (keepSelectionPath) {
          const match = list.find((item) => item.path === keepSelectionPath) || null
          setSelected(match)
          if (match) {
            const nextPerms = permsFromMode(match.mode)
            setPerms(nextPerms)
            setMode(match.modeOctal || octalFromPerms(nextPerms))
            setOwner(match.owner)
            setGroup(match.group)
            setRawOwner(match.owner)
            setRawGroup(match.group)
          }
        } else {
          setSelected(null)
        }
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return false
      } finally {
        setBusy(false)
      }
    },
    [serverId]
  )

  useEffect(() => {
    ;(async () => {
      await loadAccounts()
      try {
        const home = await window.api.files.home(serverId)
        const ok = await load(home || '/')
        if (!ok && home && home !== '/') {
          await load('/')
        }
      } catch {
        await load('/')
      }
    })()
  }, [serverId, load, loadAccounts])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [contextMenu])

  const goUp = useCallback(() => {
    if (pathRef.current === '/') return
    const parent =
      pathRef.current.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/'
    void load(parent)
  }, [load])

  const selectRow = useCallback((entry: FileEntry) => {
    setSelected(entry)
    const nextPerms = permsFromMode(entry.mode)
    setPerms(nextPerms)
    setMode(entry.modeOctal || octalFromPerms(nextPerms))
    setOwner(entry.owner)
    setGroup(entry.group)
    setRawOwner(entry.owner)
    setRawGroup(entry.group)
    setAdvancedOpen(false)
  }, [])

  const openEntry = useCallback(
    (entry: FileEntry) => {
      if (entry.type === 'directory' || entry.type === 'symlink') {
        void load(entry.path)
      } else {
        selectRow(entry)
      }
    },
    [load, selectRow]
  )

  const copyEntry = useCallback(
    (entry: FileEntry | null, mode: 'copy' | 'cut' = 'copy') => {
      if (!entry) return
      setClipboard({ serverId, path: entry.path, name: entry.name, mode })
      setMessage(mode === 'cut' ? `Cut ${entry.name}` : `Copied ${entry.name}`)
    },
    [serverId]
  )

  const pasteClipboard = useCallback(async () => {
    const clip = clipboardRef.current
    if (!clip || clip.serverId !== serverId) {
      setError('Nothing to paste')
      return
    }
    const dest = pathRef.current
    if (clip.path === dest || dest.startsWith(`${clip.path}/`)) {
      setError('Cannot paste a folder into itself')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res =
        clip.mode === 'cut'
          ? await window.api.files.move(serverId, clip.path, dest)
          : await window.api.files.copy(serverId, clip.path, dest)
      if (!res.ok) {
        setError(res.output || 'Paste failed')
        return
      }
      setMessage(clip.mode === 'cut' ? `Moved ${clip.name}` : `Pasted ${clip.name}`)
      if (clip.mode === 'cut') setClipboard(null)
      await load(dest)
    } finally {
      setBusy(false)
    }
  }, [load, serverId])

  const deleteEntry = useCallback(
    async (entry: FileEntry | null) => {
      if (!entry) return
      if (!confirm(`Delete ${entry.path}?`)) return
      setBusy(true)
      setError(null)
      try {
        const res = await window.api.files.remove(serverId, entry.path)
        if (!res.ok) setError(res.output)
        else {
          setMessage(`Deleted ${entry.name}`)
          if (clipboardRef.current?.path === entry.path) setClipboard(null)
          await load(pathRef.current)
        }
      } finally {
        setBusy(false)
      }
    },
    [load, serverId]
  )

  const downloadEntry = useCallback(
    async (entry: FileEntry | null) => {
      if (!entry || entry.type === 'directory') return
      const res = await window.api.files.download(serverId, entry.path)
      if (res.ok && 'localPath' in res) setMessage(`Downloaded to ${res.localPath}`)
    },
    [serverId]
  )

  const moveSelection = useCallback(
    (delta: number) => {
      const list = entriesRef.current
      if (!list.length) return
      const current = selectedRef.current
      const idx = current ? list.findIndex((item) => item.path === current.path) : -1
      const nextIdx = idx < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, idx + delta))
      const next = list[nextIdx]
      selectRow(next)
      requestAnimationFrame(() => {
        listRef.current
          ?.querySelector(`tr[data-path="${CSS.escape(next.path)}"]`)
          ?.scrollIntoView({ block: 'nearest' })
      })
    },
    [selectRow]
  )

  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isEditableTarget(e.target)) return

      const mod = e.ctrlKey || e.metaKey
      const entry = selectedRef.current

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        moveSelection(1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        moveSelection(-1)
        return
      }
      if (e.key === 'Home') {
        e.preventDefault()
        if (entriesRef.current[0]) selectRow(entriesRef.current[0])
        return
      }
      if (e.key === 'End') {
        e.preventDefault()
        const last = entriesRef.current[entriesRef.current.length - 1]
        if (last) selectRow(last)
        return
      }
      if (e.key === 'Enter' && entry) {
        e.preventDefault()
        openEntry(entry)
        return
      }
      if (e.key === 'Backspace' && !mod) {
        e.preventDefault()
        goUp()
        return
      }
      if ((e.key === 'Delete' || e.key === 'Del') && entry) {
        e.preventDefault()
        void deleteEntry(entry)
        return
      }
      if (mod && e.key.toLowerCase() === 'c' && entry) {
        e.preventDefault()
        copyEntry(entry, 'copy')
        return
      }
      if (mod && e.key.toLowerCase() === 'x' && entry) {
        e.preventDefault()
        copyEntry(entry, 'cut')
        return
      }
      if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        void pasteClipboard()
        return
      }
    },
    [copyEntry, deleteEntry, goUp, moveSelection, openEntry, pasteClipboard, selectRow]
  )

  const uploadLocalPaths = useCallback(
    async (localPaths: string[]) => {
      if (!localPaths.length) return
      setBusy(true)
      setError(null)
      try {
        const res = await window.api.files.uploadPaths(serverId, pathRef.current, localPaths)
        if (res.ok && 'count' in res) {
          setMessage(`Uploaded ${res.count} file(s)`)
          await load(pathRef.current)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [load, serverId]
  )

  const onDragEnter = (e: React.DragEvent) => {
    if (![...e.dataTransfer.types].includes('Files')) return
    e.preventDefault()
    dragDepth.current += 1
    setDragOver(true)
  }

  const onDragLeave = (e: React.DragEvent) => {
    if (![...e.dataTransfer.types].includes('Files')) return
    e.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragOver(false)
  }

  const onDragOver = (e: React.DragEvent) => {
    if (![...e.dataTransfer.types].includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current = 0
    setDragOver(false)
    const dropped = Array.from(e.dataTransfer.files)
    if (!dropped.length) return
    const localPaths = dropped
      .map((file) => {
        try {
          return window.api.files.getPathForFile(file)
        } catch {
          return ''
        }
      })
      .filter(Boolean)
    await uploadLocalPaths(localPaths)
  }

  const onRowDragStart = (e: React.DragEvent, entry: FileEntry) => {
    selectRow(entry)
    if (entry.type === 'directory') {
      e.preventDefault()
      return
    }
    e.preventDefault()
    setMessage(`Preparing ${entry.name} for drag…`)
    window.api.files.dragOut(serverId, entry.path)
  }

  const ownerOptions = useMemo(
    () => (selected ? ensureOption(users, selected.owner, selected.uid) : users),
    [users, selected]
  )
  const groupOptions = useMemo(
    () => (selected ? ensureOption(groups, selected.group, selected.gid) : groups),
    [groups, selected]
  )

  const applyChmod = async (value: string) => {
    if (!selected) return
    const res = await window.api.files.chmod(serverId, selected.path, value)
    if (!res.ok) setError(res.output)
    else {
      setMessage('Permissions updated')
      await load(path, selected.path)
    }
  }

  const applyChown = async (nextOwner: string, nextGroup: string) => {
    if (!selected) return
    const res = await window.api.files.chown(
      serverId,
      selected.path,
      nextOwner,
      nextGroup || undefined
    )
    if (!res.ok) setError(res.output)
    else {
      setMessage('Owner updated')
      await load(path, selected.path)
    }
  }

  const menuEntry = contextMenu?.entry ?? null
  const canPaste =
    !!clipboard && clipboard.serverId === serverId && clipboard.path !== path

  return (
    <div
      className={`panel file-manager${dragOver ? ' file-manager-dragover' : ''}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {dragOver && <div className="file-drop-overlay">Drop files to upload</div>}

      <div className="path-bar">
        <button className="btn" type="button" onClick={goUp} disabled={busy || path === '/'}>
          Up
        </button>
        <input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void load(path)
          }}
        />
        <button className="btn" type="button" disabled={busy} onClick={() => void load(path)}>
          Go
        </button>
        <button
          className="btn"
          type="button"
          disabled={busy}
          onClick={async () => {
            const name = prompt('New folder name')
            if (!name) return
            const target = path.endsWith('/') ? path + name : `${path}/${name}`
            const res = await window.api.files.mkdir(serverId, target)
            if (!res.ok) setError(res.output)
            else await load(path)
          }}
        >
          New folder
        </button>
        <button
          className="btn primary"
          type="button"
          disabled={busy}
          onClick={async () => {
            const res = await window.api.files.upload(serverId, path)
            if (res.ok && 'count' in res) {
              setMessage(`Uploaded ${res.count} file(s)`)
              await load(path)
            }
          }}
        >
          Upload
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {message && (
        <div className="muted" style={{ marginBottom: 8 }}>
          {message}
          {clipboard && (
            <span>
              {' '}
              · clipboard: {clipboard.mode === 'cut' ? 'cut' : 'copy'} {clipboard.name}
            </span>
          )}
        </div>
      )}

      <div className="split">
        <div
          className="table-wrap file-list"
          ref={listRef}
          tabIndex={0}
          role="treegrid"
          aria-label="Remote files"
          onKeyDown={handleListKeyDown}
          onClick={() => listRef.current?.focus()}
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest('tr.file-row')) return
            e.preventDefault()
            listRef.current?.focus()
            setContextMenu({ x: e.clientX, y: e.clientY, entry: null })
          }}
        >
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Access</th>
                <th>Owner</th>
                <th>Size</th>
                <th>Modified</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const navigable = entry.type === 'directory' || entry.type === 'symlink'
                return (
                  <tr
                    key={entry.path}
                    data-path={entry.path}
                    draggable={entry.type !== 'directory'}
                    className={`file-row${selected?.path === entry.path ? ' selected' : ''}${
                      clipboard?.path === entry.path && clipboard.mode === 'cut' ? ' cut' : ''
                    }`}
                    onClick={() => {
                      selectRow(entry)
                      listRef.current?.focus()
                    }}
                    onDoubleClick={() => openEntry(entry)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      selectRow(entry)
                      listRef.current?.focus()
                      setContextMenu({ x: e.clientX, y: e.clientY, entry })
                    }}
                    onDragStart={(e) => onRowDragStart(e, entry)}
                  >
                    <td>
                      <span className="file-name-cell">
                        <FileTypeIcon type={entry.type} />
                        {navigable ? (
                          <button
                            type="button"
                            className="file-name-link"
                            onClick={(e) => {
                              e.stopPropagation()
                              openEntry(entry)
                            }}
                          >
                            {entry.name}
                          </button>
                        ) : (
                          <span className="file-name">{entry.name}</span>
                        )}
                      </span>
                    </td>
                    <td>
                      <PermBadges mode={entry.mode} />
                    </td>
                    <td>
                      <span className="owner-cell" title={`uid ${entry.uid} · gid ${entry.gid}`}>
                        {entry.owner}
                        <span className="muted">:{entry.group}</span>
                      </span>
                    </td>
                    <td className="mono">
                      {entry.type === 'directory' ? '—' : formatSize(entry.size)}
                    </td>
                    <td className="mono muted">
                      {entry.mtime ? new Date(entry.mtime).toLocaleString() : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="file-details">
          <strong>Selected</strong>
          {!selected ? (
            <p className="muted">
              Use arrows to select, Enter to open, Delete to remove. Drag files in or out. Right-click
              for copy / paste / delete.
            </p>
          ) : (
            <>
              <p className="mono" style={{ wordBreak: 'break-all' }}>
                {selected.path}
              </p>
              <div className="file-details-meta">
                <PermBadges mode={selected.mode} />
                <span className="muted">
                  {selected.owner}:{selected.group}
                </span>
              </div>

              <div className="detail-section">
                <div className="detail-section-title">Permissions</div>
                <PermCheckboxes perms={perms} onChange={setPerms} />
                <div className="row-actions" style={{ marginTop: 8 }}>
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => applyChmod(octalFromPerms(perms))}
                  >
                    Apply permissions
                  </button>
                </div>
              </div>

              <div className="detail-section">
                <div className="detail-section-title">Ownership</div>
                <div className="field-row ownership-row">
                  <label>
                    User
                    <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                      {ownerOptions.map((item) => (
                        <option key={`u-${item.name}`} value={item.name}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Group
                    <select value={group} onChange={(e) => setGroup(e.target.value)}>
                      {groupOptions.map((item) => (
                        <option key={`g-${item.name}`} value={item.name}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="row-actions" style={{ marginTop: 8 }}>
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => applyChown(owner, group)}
                  >
                    Apply ownership
                  </button>
                </div>
              </div>

              <div className="detail-section">
                <button
                  type="button"
                  className="advanced-toggle"
                  onClick={() => setAdvancedOpen((open) => !open)}
                >
                  {advancedOpen ? 'Hide advanced' : 'Advanced'}
                </button>
                {advancedOpen && (
                  <div className="advanced-panel">
                    <div className="field-row" style={{ marginBottom: 8 }}>
                      <label>
                        chmod
                        <input
                          type="text"
                          value={mode}
                          onChange={(e) => setMode(e.target.value)}
                          placeholder="755"
                          style={{ marginLeft: 8, width: 90 }}
                        />
                      </label>
                      <button className="btn" type="button" onClick={() => applyChmod(mode)}>
                        Apply
                      </button>
                    </div>
                    <div className="field-row">
                      <input
                        type="text"
                        value={rawOwner}
                        onChange={(e) => setRawOwner(e.target.value)}
                        placeholder="owner"
                        style={{ width: 100 }}
                      />
                      <input
                        type="text"
                        value={rawGroup}
                        onChange={(e) => setRawGroup(e.target.value)}
                        placeholder="group"
                        style={{ width: 100 }}
                      />
                      <button
                        className="btn"
                        type="button"
                        onClick={() => applyChown(rawOwner, rawGroup)}
                      >
                        chown
                      </button>
                    </div>
                    <p className="muted" style={{ fontSize: '0.78rem', marginBottom: 0 }}>
                      Raw mode {selected.mode} · uid {selected.uid} · gid {selected.gid}
                    </p>
                  </div>
                )}
              </div>

              <div className="row-actions">
                {selected.type !== 'directory' && (
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => void downloadEntry(selected)}
                  >
                    Download
                  </button>
                )}
                <button className="btn" type="button" onClick={() => copyEntry(selected, 'copy')}>
                  Copy
                </button>
                <button
                  className="btn danger"
                  type="button"
                  onClick={() => void deleteEntry(selected)}
                >
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menuEntry && (menuEntry.type === 'directory' || menuEntry.type === 'symlink') && (
            <button
              type="button"
              onClick={() => {
                setContextMenu(null)
                openEntry(menuEntry)
              }}
            >
              Open
            </button>
          )}
          {menuEntry && menuEntry.type !== 'directory' && (
            <button
              type="button"
              onClick={() => {
                setContextMenu(null)
                void downloadEntry(menuEntry)
              }}
            >
              Download
            </button>
          )}
          {menuEntry && (
            <button
              type="button"
              onClick={() => {
                setContextMenu(null)
                copyEntry(menuEntry, 'copy')
              }}
            >
              Copy
              <span className="context-menu-hint">Ctrl+C</span>
            </button>
          )}
          {menuEntry && (
            <button
              type="button"
              onClick={() => {
                setContextMenu(null)
                copyEntry(menuEntry, 'cut')
              }}
            >
              Cut
              <span className="context-menu-hint">Ctrl+X</span>
            </button>
          )}
          <button
            type="button"
            disabled={!canPaste}
            onClick={() => {
              setContextMenu(null)
              void pasteClipboard()
            }}
          >
            Paste
            <span className="context-menu-hint">Ctrl+V</span>
          </button>
          {menuEntry && (
            <>
              <div className="context-menu-sep" />
              <button
                type="button"
                className="danger"
                onClick={() => {
                  setContextMenu(null)
                  void deleteEntry(menuEntry)
                }}
              >
                Delete
                <span className="context-menu-hint">Del</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
