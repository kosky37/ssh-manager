import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileEntry, NamedAccount, OpenTerminal } from '../types'
import { errorMessage, formatBytes, relativeTime } from '../lib/format'
import { load as loadPref, save as savePref } from '../lib/storage'
import { Icon, Spinner, useContextMenu, useDialog, useToast, type MenuEntry } from './ui'

interface Props {
  serverId: string
  active: boolean
  onOpenTerminal: OpenTerminal
}

type Triad = { r: boolean; w: boolean; x: boolean }
type PermState = { owner: Triad; group: Triad; others: Triad }
type SortKey = 'name' | 'size' | 'mtime'

type ClipboardPayload = {
  serverId: string
  path: string
  name: string
  mode: 'copy' | 'cut'
}

const EMPTY_TRIAD: Triad = { r: false, w: false, x: false }
const EMPTY_PERMS: PermState = {
  owner: { ...EMPTY_TRIAD },
  group: { ...EMPTY_TRIAD },
  others: { ...EMPTY_TRIAD }
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

function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') ? dir + name : `${dir}/${name}`
}

function parentOf(path: string): string {
  return path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/'
}

function validateName(value: string): string | null {
  const v = value.trim()
  if (!v) return 'Name is required'
  if (v.includes('/')) return 'Name cannot contain /'
  if (v === '.' || v === '..') return 'Invalid name'
  return null
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

let sharedClipboard: ClipboardPayload | null = null

export default function FileManagerPanel({ serverId, active, onOpenTerminal }: Props) {
  const [path, setPath] = useState('')
  const [pathDraft, setPathDraft] = useState('')
  const [editingPath, setEditingPath] = useState(false)
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
  const [clipboard, setClipboardState] = useState<ClipboardPayload | null>(sharedClipboard)
  const [dragOver, setDragOver] = useState(false)
  const [filter, setFilter] = useState('')
  const [showHidden, setShowHidden] = useState<boolean>(() => loadPref('files:hidden', false))
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 })
  const [history, setHistory] = useState<{ back: string[]; forward: string[] }>({
    back: [],
    forward: []
  })
  const [home, setHome] = useState('/')

  const toast = useToast()
  const dialog = useDialog()
  const menu = useContextMenu()

  const listRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const pathInputRef = useRef<HTMLInputElement>(null)
  const selectedRef = useRef<FileEntry | null>(null)
  const pathRef = useRef(path)
  const visibleRef = useRef<FileEntry[]>([])
  const clipboardRef = useRef(clipboard)
  const historyRef = useRef(history)
  const dragDepth = useRef(0)

  selectedRef.current = selected
  pathRef.current = path
  clipboardRef.current = clipboard
  historyRef.current = history

  const setClipboard = (value: ClipboardPayload | null) => {
    sharedClipboard = value
    setClipboardState(value)
  }

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const list = entries.filter(
      (e) => (showHidden || !e.name.startsWith('.')) && (!q || e.name.toLowerCase().includes(q))
    )
    return list.sort((a, b) => {
      const aDir = a.type === 'directory'
      const bDir = b.type === 'directory'
      if (aDir !== bDir) return aDir ? -1 : 1
      let cmp = 0
      if (sort.key === 'size') cmp = a.size - b.size
      else if (sort.key === 'mtime') cmp = (a.mtime || '').localeCompare(b.mtime || '')
      if (cmp === 0) cmp = a.name.localeCompare(b.name, undefined, { numeric: true })
      return cmp * sort.dir
    })
  }, [entries, filter, showHidden, sort])
  visibleRef.current = visible

  const hiddenCount = entries.filter((e) => e.name.startsWith('.')).length

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

  const applySelection = useCallback((entry: FileEntry | null) => {
    setSelected(entry)
    if (!entry) return
    const nextPerms = permsFromMode(entry.mode)
    setPerms(nextPerms)
    setMode(entry.modeOctal || octalFromPerms(nextPerms))
    setOwner(entry.owner)
    setGroup(entry.group)
    setRawOwner(entry.owner)
    setRawGroup(entry.group)
    setAdvancedOpen(false)
  }, [])

  const load = useCallback(
    async (
      target: string,
      opts?: { keepSelectionPath?: string | null; history?: 'push' | 'none' }
    ): Promise<boolean> => {
      setBusy(true)
      setError(null)
      try {
        const list = await window.api.files.list(serverId, target)
        const previous = pathRef.current
        setEntries(list)
        setPath(target)
        setPathDraft(target)
        setEditingPath(false)
        savePref(`files:path:${serverId}`, target)
        if (opts?.history !== 'none' && previous && previous !== target) {
          setHistory((h) => ({ back: [...h.back.slice(-49), previous], forward: [] }))
        }
        if (previous !== target) setFilter('')
        const match = opts?.keepSelectionPath
          ? list.find((item) => item.path === opts.keepSelectionPath) || null
          : null
        applySelection(match)
        return true
      } catch (e) {
        setError(errorMessage(e))
        return false
      } finally {
        setBusy(false)
      }
    },
    [serverId, applySelection]
  )

  const reload = useCallback(
    (keepSelectionPath?: string | null) =>
      load(pathRef.current, {
        keepSelectionPath: keepSelectionPath ?? selectedRef.current?.path,
        history: 'none'
      }),
    [load]
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await loadAccounts()
      let start = '/'
      try {
        start = (await window.api.files.home(serverId)) || '/'
      } catch {
        start = '/'
      }
      if (cancelled) return
      setHome(start)
      const remembered = loadPref<string | null>(`files:path:${serverId}`, null)
      if (remembered && (await load(remembered, { history: 'none' }))) return
      if (!(await load(start, { history: 'none' })) && start !== '/') {
        await load('/', { history: 'none' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [serverId, load, loadAccounts])

  const goUp = useCallback(() => {
    if (pathRef.current === '/') return
    const current = pathRef.current
    void load(parentOf(current), { keepSelectionPath: current })
  }, [load])

  const goBack = useCallback(async () => {
    const h = historyRef.current
    const prev = h.back[h.back.length - 1]
    if (!prev) return
    const current = pathRef.current
    if (await load(prev, { history: 'none' })) {
      setHistory({ back: h.back.slice(0, -1), forward: [current, ...h.forward] })
    }
  }, [load])

  const goForward = useCallback(async () => {
    const h = historyRef.current
    const next = h.forward[0]
    if (!next) return
    const current = pathRef.current
    if (await load(next, { history: 'none' })) {
      setHistory({ back: [...h.back, current], forward: h.forward.slice(1) })
    }
  }, [load])

  const openEntry = useCallback(
    (entry: FileEntry) => {
      if (entry.type === 'directory' || entry.type === 'symlink') {
        void load(entry.path)
      } else {
        applySelection(entry)
      }
    },
    [load, applySelection]
  )

  const copyEntry = useCallback(
    (entry: FileEntry | null, kind: 'copy' | 'cut' = 'copy') => {
      if (!entry) return
      setClipboard({ serverId, path: entry.path, name: entry.name, mode: kind })
      toast({
        title: kind === 'cut' ? `Cut ${entry.name}` : `Copied ${entry.name}`,
        detail: 'Paste with Ctrl+V in another folder'
      })
    },
    [serverId, toast]
  )

  const pasteClipboard = useCallback(async () => {
    const clip = clipboardRef.current
    if (!clip || clip.serverId !== serverId) {
      toast({ kind: 'info', title: 'Nothing to paste' })
      return
    }
    const dest = pathRef.current
    if (clip.path === dest || dest.startsWith(`${clip.path}/`)) {
      toast({ kind: 'error', title: 'Cannot paste a folder into itself' })
      return
    }
    setBusy(true)
    try {
      const res =
        clip.mode === 'cut'
          ? await window.api.files.move(serverId, clip.path, dest)
          : await window.api.files.copy(serverId, clip.path, dest)
      if (!res.ok) {
        toast({ kind: 'error', title: 'Paste failed', detail: res.output })
        return
      }
      toast({ kind: 'success', title: clip.mode === 'cut' ? `Moved ${clip.name}` : `Pasted ${clip.name}` })
      if (clip.mode === 'cut') setClipboard(null)
      await reload(joinPath(dest, clip.name))
    } catch (e) {
      toast({ kind: 'error', title: 'Paste failed', detail: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }, [reload, serverId, toast])

  const deleteEntry = useCallback(
    async (entry: FileEntry | null) => {
      if (!entry) return
      const ok = await dialog.confirm({
        title: `Delete ${entry.name}?`,
        message: (
          <>
            <span className="mono">{entry.path}</span>
            {entry.type === 'directory' && (
              <p className="muted">The folder and everything inside it will be removed.</p>
            )}
            <p className="muted">This cannot be undone.</p>
          </>
        ),
        confirmLabel: 'Delete',
        danger: true
      })
      if (!ok) return
      setBusy(true)
      try {
        const res = await window.api.files.remove(serverId, entry.path)
        if (!res.ok) toast({ kind: 'error', title: 'Delete failed', detail: res.output })
        else {
          toast({ kind: 'success', title: `Deleted ${entry.name}` })
          if (clipboardRef.current?.path === entry.path) setClipboard(null)
          const list = visibleRef.current
          const idx = list.findIndex((e) => e.path === entry.path)
          const neighbor = list[idx + 1] || list[idx - 1]
          await reload(neighbor?.path ?? null)
        }
      } catch (e) {
        toast({ kind: 'error', title: 'Delete failed', detail: errorMessage(e) })
      } finally {
        setBusy(false)
        listRef.current?.focus()
      }
    },
    [dialog, reload, serverId, toast]
  )

  const renameEntry = useCallback(
    async (entry: FileEntry | null) => {
      if (!entry) return
      const name = await dialog.prompt({
        title: `Rename ${entry.type === 'directory' ? 'folder' : 'file'}`,
        label: 'New name',
        defaultValue: entry.name,
        confirmLabel: 'Rename',
        selectStem: entry.type !== 'directory',
        validate: (v) => validateName(v) || (v.trim() === entry.name ? 'Name unchanged' : null)
      })
      if (!name) return
      const target = joinPath(parentOf(entry.path), name.trim())
      try {
        const res = await window.api.files.rename(serverId, entry.path, target)
        if (!res.ok) toast({ kind: 'error', title: 'Rename failed', detail: res.output })
        else await reload(target)
      } catch (e) {
        toast({ kind: 'error', title: 'Rename failed', detail: errorMessage(e) })
      } finally {
        listRef.current?.focus()
      }
    },
    [dialog, reload, serverId, toast]
  )

  const createItem = useCallback(
    async (kind: 'folder' | 'file') => {
      const name = await dialog.prompt({
        title: kind === 'folder' ? 'New folder' : 'New file',
        label: 'Name',
        placeholder: kind === 'folder' ? 'new-folder' : 'notes.txt',
        confirmLabel: 'Create',
        validate: validateName
      })
      if (!name) return
      const target = joinPath(pathRef.current, name.trim())
      try {
        const res =
          kind === 'folder'
            ? await window.api.files.mkdir(serverId, target)
            : await window.api.files.touch(serverId, target)
        if (!res.ok) toast({ kind: 'error', title: `Could not create ${kind}`, detail: res.output })
        else await reload(target)
      } catch (e) {
        toast({ kind: 'error', title: `Could not create ${kind}`, detail: errorMessage(e) })
      } finally {
        listRef.current?.focus()
      }
    },
    [dialog, reload, serverId, toast]
  )

  const downloadEntry = useCallback(
    async (entry: FileEntry | null) => {
      if (!entry || entry.type === 'directory') return
      try {
        const res = await window.api.files.download(serverId, entry.path)
        if (res.ok) {
          const local = res.localPath
          toast({
            kind: 'success',
            title: `Downloaded ${entry.name}`,
            detail: local,
            action: { label: 'Show', onClick: () => void window.api.files.showLocal(local) }
          })
        }
      } catch (e) {
        toast({ kind: 'error', title: 'Download failed', detail: errorMessage(e) })
      }
    },
    [serverId, toast]
  )

  const copyPathText = useCallback(
    (text: string) => {
      window.api.clipboard.writeText(text)
      toast({ kind: 'success', title: 'Path copied', detail: text })
    },
    [toast]
  )

  const terminalHere = useCallback(
    (entry: FileEntry | null) => {
      const dir = entry && entry.type === 'directory' ? entry.path : pathRef.current
      onOpenTerminal({ title: dir.split('/').pop() || '/', cwd: dir })
    },
    [onOpenTerminal]
  )

  const moveSelection = useCallback(
    (delta: number) => {
      const list = visibleRef.current
      if (!list.length) return
      const current = selectedRef.current
      const found = current ? list.findIndex((item) => item.path === current.path) : -1
      const idx = found >= 0 ? found : delta > 0 ? -1 : list.length
      const nextIdx = Math.max(0, Math.min(list.length - 1, idx + delta))
      const next = list[nextIdx]
      applySelection(next)
      requestAnimationFrame(() => {
        listRef.current
          ?.querySelector(`tr[data-path="${CSS.escape(next.path)}"]`)
          ?.scrollIntoView({ block: 'nearest' })
      })
    },
    [applySelection]
  )

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role=dialog]')) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        filterRef.current?.focus()
        filterRef.current?.select()
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        setEditingPath(true)
        requestAnimationFrame(() => pathInputRef.current?.select())
      } else if (e.key === 'F5') {
        e.preventDefault()
        void reload()
      } else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        void goBack()
      } else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault()
        void goForward()
      } else if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault()
        goUp()
      }
    }
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) void goBack()
      if (e.button === 4) void goForward()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [active, reload, goBack, goForward, goUp])

  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isEditableTarget(e.target)) return

      const mod = e.ctrlKey || e.metaKey
      const entry = selectedRef.current

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        moveSelection(1)
      } else if (e.key === 'ArrowUp' && !e.altKey) {
        e.preventDefault()
        moveSelection(-1)
      } else if (e.key === 'PageDown') {
        e.preventDefault()
        moveSelection(10)
      } else if (e.key === 'PageUp') {
        e.preventDefault()
        moveSelection(-10)
      } else if (e.key === 'Home') {
        e.preventDefault()
        moveSelection(-Infinity)
      } else if (e.key === 'End') {
        e.preventDefault()
        moveSelection(Infinity)
      } else if (e.key === 'Enter' && entry) {
        e.preventDefault()
        openEntry(entry)
      } else if (e.key === 'Backspace' && !mod) {
        e.preventDefault()
        goUp()
      } else if (e.key === 'F2' && entry) {
        e.preventDefault()
        void renameEntry(entry)
      } else if (e.key === 'Delete' && entry) {
        e.preventDefault()
        void deleteEntry(entry)
      } else if (e.key === 'Escape') {
        if (filter) setFilter('')
        else applySelection(null)
      } else if (mod && e.key.toLowerCase() === 'c' && entry) {
        e.preventDefault()
        copyEntry(entry, 'copy')
      } else if (mod && e.key.toLowerCase() === 'x' && entry) {
        e.preventDefault()
        copyEntry(entry, 'cut')
      } else if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        void pasteClipboard()
      } else if (!mod && !e.altKey && e.key.length === 1 && /\S/.test(e.key)) {
        const ch = e.key.toLowerCase()
        const list = visibleRef.current
        const start = entry ? list.findIndex((x) => x.path === entry.path) + 1 : 0
        const ordered = [...list.slice(start), ...list.slice(0, start)]
        const hit = ordered.find((x) => x.name.toLowerCase().startsWith(ch))
        if (hit) {
          applySelection(hit)
          requestAnimationFrame(() => {
            listRef.current
              ?.querySelector(`tr[data-path="${CSS.escape(hit.path)}"]`)
              ?.scrollIntoView({ block: 'nearest' })
          })
        }
      }
    },
    [
      applySelection,
      copyEntry,
      deleteEntry,
      filter,
      goUp,
      moveSelection,
      openEntry,
      pasteClipboard,
      renameEntry
    ]
  )

  const uploadLocalPaths = useCallback(
    async (localPaths: string[]) => {
      if (!localPaths.length) return
      setBusy(true)
      toast({ title: `Uploading ${localPaths.length} file(s)…` })
      try {
        const res = await window.api.files.uploadPaths(serverId, pathRef.current, localPaths)
        if (res.ok) {
          toast({ kind: 'success', title: `Uploaded ${res.count} file(s)` })
          await reload()
        }
      } catch (e) {
        toast({ kind: 'error', title: 'Upload failed', detail: errorMessage(e) })
      } finally {
        setBusy(false)
      }
    },
    [reload, serverId, toast]
  )

  const uploadPicker = async () => {
    try {
      const res = await window.api.files.upload(serverId, pathRef.current)
      if (res.ok) {
        toast({ kind: 'success', title: `Uploaded ${res.count} file(s)` })
        await reload()
      }
    } catch (e) {
      toast({ kind: 'error', title: 'Upload failed', detail: errorMessage(e) })
    }
  }

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
    applySelection(entry)
    e.preventDefault()
    if (entry.type === 'directory') return
    toast({ title: `Preparing ${entry.name} for drag…` })
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
    try {
      const res = await window.api.files.chmod(serverId, selected.path, value)
      if (!res.ok) toast({ kind: 'error', title: 'chmod failed', detail: res.output })
      else {
        toast({ kind: 'success', title: 'Permissions updated' })
        await reload(selected.path)
      }
    } catch (e) {
      toast({ kind: 'error', title: 'chmod failed', detail: errorMessage(e) })
    }
  }

  const applyChown = async (nextOwner: string, nextGroup: string) => {
    if (!selected) return
    try {
      const res = await window.api.files.chown(serverId, selected.path, nextOwner, nextGroup || undefined)
      if (!res.ok) toast({ kind: 'error', title: 'chown failed', detail: res.output })
      else {
        toast({ kind: 'success', title: 'Owner updated' })
        await reload(selected.path)
      }
    } catch (e) {
      toast({ kind: 'error', title: 'chown failed', detail: errorMessage(e) })
    }
  }

  const canPaste = !!clipboard && clipboard.serverId === serverId && clipboard.path !== path

  const entryMenu = (entry: FileEntry | null): MenuEntry[] => {
    const items: MenuEntry[] = []
    if (entry) {
      if (entry.type === 'directory' || entry.type === 'symlink') {
        items.push({ label: 'Open', icon: 'folder', hint: 'Enter', onSelect: () => openEntry(entry) })
      }
      if (entry.type !== 'directory') {
        items.push({ label: 'Download…', icon: 'download', onSelect: () => void downloadEntry(entry) })
      }
      items.push(
        { label: 'Rename…', icon: 'edit', hint: 'F2', onSelect: () => void renameEntry(entry) },
        'separator',
        { label: 'Copy', icon: 'copy', hint: 'Ctrl+C', onSelect: () => copyEntry(entry, 'copy') },
        { label: 'Cut', icon: 'copy', hint: 'Ctrl+X', onSelect: () => copyEntry(entry, 'cut') }
      )
    }
    items.push({
      label: 'Paste',
      icon: 'copy',
      hint: 'Ctrl+V',
      disabled: !canPaste,
      onSelect: () => void pasteClipboard()
    })
    items.push('separator')
    items.push({
      label: 'Copy path',
      icon: 'link',
      onSelect: () => copyPathText(entry ? entry.path : pathRef.current)
    })
    items.push({
      label: 'Open terminal here',
      icon: 'terminal',
      onSelect: () => terminalHere(entry)
    })
    if (!entry) {
      items.push(
        'separator',
        { label: 'New folder…', icon: 'folderPlus', onSelect: () => void createItem('folder') },
        { label: 'New file…', icon: 'filePlus', onSelect: () => void createItem('file') },
        { label: 'Upload files…', icon: 'upload', onSelect: () => void uploadPicker() },
        { label: 'Refresh', icon: 'refresh', hint: 'F5', onSelect: () => void reload() }
      )
    } else {
      items.push('separator', {
        label: 'Delete',
        icon: 'trash',
        hint: 'Del',
        danger: true,
        onSelect: () => void deleteEntry(entry)
      })
    }
    return items
  }

  const crumbs = useMemo(() => {
    const parts = path.split('/').filter(Boolean)
    return [
      { label: '/', path: '/' },
      ...parts.map((part, i) => ({ label: part, path: '/' + parts.slice(0, i + 1).join('/') }))
    ]
  }, [path])

  const sortHeader = (key: SortKey, label: string, className?: string) => (
    <th className={className}>
      <button
        type="button"
        className={`sort-btn${sort.key === key ? ' active' : ''}`}
        onClick={() => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }))}
      >
        {label}
        {sort.key === key && <span className="sort-arrow">{sort.dir === 1 ? '▲' : '▼'}</span>}
      </button>
    </th>
  )

  return (
    <div
      className={`panel file-manager${dragOver ? ' file-manager-dragover' : ''}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="file-drop-overlay">
          <Icon name="upload" size={28} />
          Drop files to upload to {path}
        </div>
      )}

      <div className="path-bar">
        <div className="btn-group">
          <button
            className="icon-btn"
            type="button"
            title="Back (Alt+←)"
            disabled={history.back.length === 0}
            onClick={() => void goBack()}
          >
            <Icon name="arrowLeft" size={15} />
          </button>
          <button
            className="icon-btn"
            type="button"
            title="Forward (Alt+→)"
            disabled={history.forward.length === 0}
            onClick={() => void goForward()}
          >
            <Icon name="arrowRight" size={15} />
          </button>
          <button
            className="icon-btn"
            type="button"
            title="Up (Backspace)"
            disabled={path === '/'}
            onClick={goUp}
          >
            <Icon name="arrowUp" size={15} />
          </button>
          <button
            className="icon-btn"
            type="button"
            title={`Home (${home})`}
            onClick={() => void load(home)}
          >
            <Icon name="home" size={15} />
          </button>
        </div>

        {editingPath ? (
          <input
            ref={pathInputRef}
            className="path-input"
            type="text"
            value={pathDraft}
            autoFocus
            spellCheck={false}
            onChange={(e) => setPathDraft(e.target.value)}
            onBlur={() => {
              setEditingPath(false)
              setPathDraft(path)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void load(pathDraft.trim() || '/')
              if (e.key === 'Escape') {
                setEditingPath(false)
                setPathDraft(path)
                listRef.current?.focus()
              }
            }}
          />
        ) : (
          <div
            className="breadcrumbs"
            title="Click empty space or press Ctrl+L to type a path"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setEditingPath(true)
                requestAnimationFrame(() => pathInputRef.current?.select())
              }
            }}
          >
            {crumbs.map((c, i) => (
              <span key={c.path} className="crumb-wrap">
                {i > 1 && <span className="crumb-sep">/</span>}
                <button type="button" className="crumb" onClick={() => void load(c.path)}>
                  {c.label}
                </button>
              </span>
            ))}
          </div>
        )}

        <button className="icon-btn" type="button" title="Refresh (F5)" disabled={busy} onClick={() => void reload()}>
          {busy ? <Spinner /> : <Icon name="refresh" size={15} />}
        </button>
      </div>

      <div className="panel-toolbar files-toolbar">
        <div className="search-box compact">
          <Icon name="search" size={14} />
          <input
            ref={filterRef}
            type="text"
            placeholder="Filter (Ctrl+F)"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setFilter('')
                listRef.current?.focus()
              }
              if (e.key === 'ArrowDown' || e.key === 'Enter') {
                e.preventDefault()
                listRef.current?.focus()
                if (!selectedRef.current && visibleRef.current[0]) applySelection(visibleRef.current[0])
              }
            }}
          />
        </div>
        <button
          type="button"
          className={`btn small${showHidden ? ' toggled' : ''}`}
          title="Show hidden files"
          onClick={() => {
            setShowHidden((v) => {
              savePref('files:hidden', !v)
              return !v
            })
          }}
        >
          <Icon name={showHidden ? 'eye' : 'eyeOff'} size={14} />
          Hidden{hiddenCount > 0 ? ` (${hiddenCount})` : ''}
        </button>
        <span className="muted small-text">
          {visible.length} item{visible.length === 1 ? '' : 's'}
          {clipboard && clipboard.serverId === serverId && (
            <> · clipboard: {clipboard.mode} {clipboard.name}</>
          )}
        </span>
        <span className="spacer" />
        <button className="btn small" type="button" disabled={busy} onClick={() => terminalHere(null)}>
          <Icon name="terminal" size={14} /> Terminal here
        </button>
        <button className="btn small" type="button" disabled={busy} onClick={() => void createItem('folder')}>
          <Icon name="folderPlus" size={14} /> New folder
        </button>
        <button className="btn small" type="button" disabled={busy} onClick={() => void createItem('file')}>
          <Icon name="filePlus" size={14} /> New file
        </button>
        <button className="btn small primary" type="button" disabled={busy} onClick={() => void uploadPicker()}>
          <Icon name="upload" size={14} /> Upload
        </button>
      </div>

      {error && (
        <div className="error-banner">
          <Icon name="alert" size={14} />
          <span>{error}</span>
        </div>
      )}

      <div className="split files-split">
        <div
          className="table-wrap file-list"
          ref={listRef}
          tabIndex={0}
          role="grid"
          aria-label="Remote files"
          onKeyDown={handleListKeyDown}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) applySelection(null)
          }}
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest('tr.file-row')) return
            e.preventDefault()
            listRef.current?.focus()
            menu.open(e, entryMenu(null))
          }}
        >
          <table>
            <thead>
              <tr>
                {sortHeader('name', 'Name')}
                <th>Access</th>
                <th>Owner</th>
                {sortHeader('size', 'Size', 'num')}
                {sortHeader('mtime', 'Modified')}
              </tr>
            </thead>
            <tbody>
              {path !== '/' && !filter && (
                <tr className="file-row parent-row" onDoubleClick={goUp} onClick={() => listRef.current?.focus()}>
                  <td colSpan={5}>
                    <span className="file-name-cell muted">
                      <Icon name="arrowUp" size={14} /> ..
                    </span>
                  </td>
                </tr>
              )}
              {visible.map((entry) => {
                const navigable = entry.type === 'directory' || entry.type === 'symlink'
                return (
                  <tr
                    key={entry.path}
                    data-path={entry.path}
                    draggable={entry.type !== 'directory'}
                    className={`file-row${selected?.path === entry.path ? ' selected' : ''}${
                      clipboard?.path === entry.path && clipboard.mode === 'cut' ? ' cut' : ''
                    }${entry.name.startsWith('.') ? ' hidden-file' : ''}`}
                    onClick={() => {
                      applySelection(entry)
                      listRef.current?.focus()
                    }}
                    onDoubleClick={() => openEntry(entry)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      applySelection(entry)
                      listRef.current?.focus()
                      menu.open(e, entryMenu(entry))
                    }}
                    onDragStart={(e) => onRowDragStart(e, entry)}
                  >
                    <td>
                      <span className="file-name-cell">
                        <FileTypeIcon type={entry.type} />
                        <span className={navigable ? 'file-name dir' : 'file-name'}>{entry.name}</span>
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
                    <td className="mono num">
                      {entry.type === 'directory' ? '—' : formatBytes(entry.size)}
                    </td>
                    <td
                      className="mono muted"
                      title={entry.mtime ? new Date(entry.mtime).toLocaleString() : ''}
                    >
                      {relativeTime(entry.mtime)}
                    </td>
                  </tr>
                )
              })}
              {visible.length === 0 && !busy && (
                <tr>
                  <td colSpan={5} className="muted empty-row">
                    {entries.length === 0
                      ? 'This folder is empty. Drop files here to upload.'
                      : filter
                        ? `Nothing matches “${filter}”.`
                        : 'Only hidden files here.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="file-details">
          {!selected ? (
            <div className="details-empty">
              <Icon name="folder" size={28} />
              <p className="muted">Select a file to see details and permissions.</p>
              <ul className="shortcut-list muted">
                <li>
                  <kbd className="kbd">Enter</kbd> open · <kbd className="kbd">Backspace</kbd> up
                </li>
                <li>
                  <kbd className="kbd">F2</kbd> rename · <kbd className="kbd">Del</kbd> delete
                </li>
                <li>
                  <kbd className="kbd">Ctrl+C</kbd> / <kbd className="kbd">X</kbd> /{' '}
                  <kbd className="kbd">V</kbd> copy, cut, paste
                </li>
                <li>Drag files in to upload, or out to download</li>
              </ul>
            </div>
          ) : (
            <>
              <div className="details-head">
                <FileTypeIcon type={selected.type} />
                <strong className="details-name">{selected.name}</strong>
              </div>
              <button
                type="button"
                className="path-copy mono"
                title="Copy path"
                onClick={() => copyPathText(selected.path)}
              >
                {selected.path} <Icon name="copy" size={12} />
              </button>
              <div className="file-details-meta">
                <PermBadges mode={selected.mode} />
                <span className="muted">
                  {selected.owner}:{selected.group}
                </span>
                {selected.type !== 'directory' && (
                  <span className="muted">{formatBytes(selected.size)}</span>
                )}
              </div>

              <div className="row-actions" style={{ marginBottom: '0.9rem' }}>
                {selected.type === 'directory' || selected.type === 'symlink' ? (
                  <button className="btn small primary" type="button" onClick={() => openEntry(selected)}>
                    <Icon name="folder" size={13} /> Open
                  </button>
                ) : (
                  <button
                    className="btn small primary"
                    type="button"
                    onClick={() => void downloadEntry(selected)}
                  >
                    <Icon name="download" size={13} /> Download
                  </button>
                )}
                <button className="btn small" type="button" onClick={() => void renameEntry(selected)}>
                  <Icon name="edit" size={13} /> Rename
                </button>
                <button className="btn small" type="button" onClick={() => copyEntry(selected, 'copy')}>
                  <Icon name="copy" size={13} /> Copy
                </button>
                <button className="btn small danger" type="button" onClick={() => void deleteEntry(selected)}>
                  <Icon name="trash" size={13} /> Delete
                </button>
              </div>

              <div className="detail-section">
                <div className="detail-section-title">Permissions</div>
                <PermCheckboxes perms={perms} onChange={setPerms} />
                <div className="row-actions" style={{ marginTop: 8 }}>
                  <button
                    className="btn small"
                    type="button"
                    disabled={octalFromPerms(perms) === octalFromPerms(permsFromMode(selected.mode))}
                    onClick={() => void applyChmod(octalFromPerms(perms))}
                  >
                    Apply permissions ({octalFromPerms(perms)})
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
                    className="btn small"
                    type="button"
                    disabled={owner === selected.owner && group === selected.group}
                    onClick={() => void applyChown(owner, group)}
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
                          style={{ marginLeft: 8, width: 90, minWidth: 0 }}
                        />
                      </label>
                      <button className="btn small" type="button" onClick={() => void applyChmod(mode)}>
                        Apply
                      </button>
                    </div>
                    <div className="field-row">
                      <input
                        type="text"
                        value={rawOwner}
                        onChange={(e) => setRawOwner(e.target.value)}
                        placeholder="owner"
                        style={{ width: 100, minWidth: 0 }}
                      />
                      <input
                        type="text"
                        value={rawGroup}
                        onChange={(e) => setRawGroup(e.target.value)}
                        placeholder="group"
                        style={{ width: 100, minWidth: 0 }}
                      />
                      <button
                        className="btn small"
                        type="button"
                        onClick={() => void applyChown(rawOwner, rawGroup)}
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
            </>
          )}
        </div>
      </div>

      {menu.element}
    </div>
  )
}
