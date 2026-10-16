import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import type { TerminalSpec } from '../types'
import { Icon, useContextMenu } from './ui'

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  bytes.forEach((b) => {
    binary += String.fromCharCode(b)
  })
  return btoa(binary)
}

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

const APP_SHORTCUT_KEYS = new Set(['t', 'w', 'k', 'n', 'b', 'f', 'c', 'v'])

function isAppShortcut(e: KeyboardEvent): boolean {
  if (e.key === 'F1') return true
  if (!e.ctrlKey || e.altKey) return false
  const key = e.key.toLowerCase()
  if (e.shiftKey && APP_SHORTCUT_KEYS.has(key)) return true
  if (!e.shiftKey && /^[1-5]$/.test(key)) return true
  if (key === 'tab' || key === 'pageup' || key === 'pagedown') return true
  if (!e.shiftKey && (key === '=' || key === '+' || key === '-' || key === '0')) return true
  return false
}

interface ViewProps {
  serverId: string
  spec: TerminalSpec
  active: boolean
  fontSize: number
  onExit: () => void
}

function TerminalView({ serverId, spec, active, fontSize, onExit }: ViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [closed, setClosed] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "'IBM Plex Mono', Consolas, monospace",
      fontSize,
      scrollback: 10000,
      allowProposedApi: true,
      theme: {
        background: '#0a100e',
        foreground: '#d7eee3',
        cursor: '#3dba8c',
        cursorAccent: '#0a100e',
        selectionBackground: '#2a5a47',
        black: '#1a2420',
        brightBlack: '#5a6b62',
        green: '#4ecf7a',
        brightGreen: '#6fe39a',
        yellow: '#e0a04a',
        brightYellow: '#f0c070',
        red: '#e85a66',
        brightRed: '#ff7a85',
        blue: '#5aa7e8',
        brightBlue: '#7ec8ff',
        cyan: '#3dba8c',
        brightCyan: '#5fd8aa',
        magenta: '#c27ae0',
        brightMagenta: '#d89cf0'
      }
    })
    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        if (event.ctrlKey || event.metaKey) window.open(uri, '_blank')
      })
    )
    term.open(container)
    termRef.current = term
    fitRef.current = fit
    searchRef.current = search

    const safeFit = () => {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        try {
          fit.fit()
        } catch {
          return
        }
      }
    }
    safeFit()

    const id = `term-${spec.id}-${Math.random().toString(36).slice(2, 9)}`
    let disposed = false
    setClosed(false)

    const copySelection = (): boolean => {
      const text = term.getSelection()
      if (!text) return false
      window.api.clipboard.writeText(text)
      term.clearSelection()
      return true
    }

    const paste = () => {
      const text = window.api.clipboard.readText()
      if (text) term.paste(text)
    }

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const key = e.key.toLowerCase()
      if (e.ctrlKey && e.shiftKey && key === 'c') {
        copySelection()
        return false
      }
      if (e.ctrlKey && e.shiftKey && key === 'v') {
        paste()
        e.preventDefault()
        return false
      }
      if (e.ctrlKey && e.shiftKey && key === 'f') {
        setSearchOpen(true)
        requestAnimationFrame(() => searchInputRef.current?.select())
        return false
      }
      if (e.ctrlKey && !e.shiftKey && key === 'c' && term.hasSelection()) {
        copySelection()
        return false
      }
      if (e.ctrlKey && !e.shiftKey && key === 'v') {
        paste()
        e.preventDefault()
        return false
      }
      return !isAppShortcut(e)
    })

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      if (term.hasSelection()) {
        copySelection()
      } else {
        paste()
      }
    }
    container.addEventListener('contextmenu', onContextMenu)

    const start = async () => {
      const dims = fit.proposeDimensions()
      try {
        await window.api.terminal.open(serverId, id, {
          cols: dims?.cols || 120,
          rows: dims?.rows || 30,
          su: spec.su,
          command: spec.command,
          cwd: spec.cwd
        })
      } catch (e) {
        term.writeln(`\x1b[31m${e instanceof Error ? e.message : String(e)}\x1b[0m`)
        setClosed(true)
        return
      }
      if (disposed) {
        await window.api.terminal.close(id)
        return
      }
      if (activeRef.current) term.focus()
    }

    void start()

    const unsubData = window.api.terminal.onData((payload) => {
      if (payload.termId === id) term.write(decodeBase64(payload.data))
    })

    const unsubClosed = window.api.terminal.onClosed((payload) => {
      if (payload.termId === id) {
        term.writeln('\r\n\x1b[90m[session closed]\x1b[0m')
        setClosed(true)
      }
    })

    const dataSub = term.onData((data) => {
      window.api.terminal.input(id, toBase64(data))
    })

    const resizeSub = term.onResize(({ cols, rows }) => {
      window.api.terminal.resize(id, cols, rows)
    })

    const ro = new ResizeObserver(() => safeFit())
    ro.observe(container)

    return () => {
      disposed = true
      unsubData()
      unsubClosed()
      dataSub.dispose()
      resizeSub.dispose()
      ro.disconnect()
      container.removeEventListener('contextmenu', onContextMenu)
      void window.api.terminal.close(id)
      term.dispose()
      termRef.current = null
    }
  }, [serverId, spec.id, spec.su, spec.command, spec.cwd, nonce])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontSize = fontSize
    const container = containerRef.current
    if (container && container.clientWidth > 0) {
      try {
        fitRef.current?.fit()
      } catch {
        return
      }
    }
  }, [fontSize])

  useEffect(() => {
    if (!active) return
    const raf = requestAnimationFrame(() => {
      const container = containerRef.current
      if (container && container.clientWidth > 0) {
        try {
          fitRef.current?.fit()
        } catch {
          return
        }
      }
      if (!searchOpen) termRef.current?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [active])

  useEffect(() => {
    if (!closed || !active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        setNonce((n) => n + 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closed, active])

  const find = (backwards = false) => {
    if (!searchTerm) return
    const opts = {
      decorations: {
        matchBackground: '#1f4a3a',
        activeMatchBackground: '#e0a04a',
        matchOverviewRuler: '#3dba8c',
        activeMatchColorOverviewRuler: '#e0a04a'
      }
    }
    if (backwards) searchRef.current?.findPrevious(searchTerm, opts)
    else searchRef.current?.findNext(searchTerm, opts)
  }

  return (
    <div className={`terminal-view${active ? ' active' : ''}`}>
      <div className="terminal-wrap" ref={containerRef} />
      {searchOpen && (
        <div className="terminal-search">
          <Icon name="search" size={14} />
          <input
            ref={searchInputRef}
            type="text"
            value={searchTerm}
            placeholder="Find in terminal"
            autoFocus
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                find(e.shiftKey)
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                searchRef.current?.clearDecorations()
                setSearchOpen(false)
                termRef.current?.focus()
              }
            }}
          />
          <button type="button" className="icon-btn" title="Previous (Shift+Enter)" onClick={() => find(true)}>
            <Icon name="arrowUp" size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Next (Enter)"
            onClick={() => find(false)}
            style={{ transform: 'rotate(180deg)' }}
          >
            <Icon name="arrowUp" size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Close (Esc)"
            onClick={() => {
              searchRef.current?.clearDecorations()
              setSearchOpen(false)
              termRef.current?.focus()
            }}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
      {closed && (
        <div className="terminal-closed">
          <span>Session ended.</span>
          <button type="button" className="btn small primary" onClick={() => setNonce((n) => n + 1)}>
            <Icon name="restart" size={14} /> Restart <span className="muted">(Enter)</span>
          </button>
          <button type="button" className="btn small" onClick={onExit}>
            Close tab
          </button>
        </div>
      )}
    </div>
  )
}

interface WorkspaceProps {
  serverId: string
  terminals: TerminalSpec[]
  activeTermId: string | null
  visible: boolean
  fontSize: number
  canElevate: boolean
  defaultSu: boolean
  onSelect: (id: string) => void
  onNew: (su: boolean) => void
  onClose: (id: string) => void
}

export default function TerminalWorkspace({
  serverId,
  terminals,
  activeTermId,
  visible,
  fontSize,
  canElevate,
  defaultSu,
  onSelect,
  onNew,
  onClose
}: WorkspaceProps) {
  const menu = useContextMenu()

  return (
    <div className="terminal-workspace">
      <div className="terminal-tabs">
        {terminals.map((t) => (
          <div
            key={t.id}
            role="tab"
            tabIndex={0}
            aria-selected={t.id === activeTermId}
            className={`terminal-tab${t.id === activeTermId ? ' active' : ''}`}
            onClick={() => onSelect(t.id)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                onClose(t.id)
              }
            }}
            title={t.command || t.title}
          >
            <Icon name={t.command ? 'docker' : 'terminal'} size={13} />
            <span className="terminal-tab-title">{t.title}</span>
            {t.su && canElevate && <span className="root-badge">root</span>}
            <button
              type="button"
              className="icon-btn tiny"
              aria-label="Close terminal"
              onClick={(e) => {
                e.stopPropagation()
                onClose(t.id)
              }}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
        <div className="terminal-new">
          <button
            type="button"
            className="icon-btn"
            title="New terminal (Ctrl+Shift+T)"
            onClick={() => onNew(defaultSu)}
          >
            <Icon name="plus" size={14} />
          </button>
          {canElevate && (
            <button
              type="button"
              className="icon-btn"
              title="Terminal options"
              onClick={(e) =>
                menu.open(e, [
                  { label: 'New root shell', icon: 'shield', onSelect: () => onNew(true) },
                  { label: 'New user shell', icon: 'user', onSelect: () => onNew(false) }
                ])
              }
            >
              <Icon name="chevronDown" size={14} />
            </button>
          )}
        </div>
        <span className="terminal-tabs-hint muted">
          Right-click: copy / paste · Ctrl+Shift+F: find
        </span>
      </div>
      <div className="terminal-stack">
        {terminals.map((t) => (
          <TerminalView
            key={t.id}
            serverId={serverId}
            spec={t}
            active={visible && t.id === activeTermId}
            fontSize={fontSize}
            onExit={() => onClose(t.id)}
          />
        ))}
        {terminals.length === 0 && (
          <div className="empty">
            <h2>No open terminals</h2>
            <p>Open a shell on this host.</p>
            <button type="button" className="btn primary" onClick={() => onNew(defaultSu)}>
              <Icon name="plus" size={14} /> New terminal
            </button>
          </div>
        )}
      </div>
      {menu.element}
    </div>
  )
}
