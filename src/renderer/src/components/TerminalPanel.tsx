import { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import 'xterm/css/xterm.css'

interface Props {
  serverId: string
  su: boolean
}

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  bytes.forEach((b) => {
    binary += String.fromCharCode(b)
  })
  return btoa(binary)
}

function fromBase64(b64: string): string {
  const binary = atob(b64)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export default function TerminalPanel({ serverId, su }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 13,
      theme: {
        background: '#0a100e',
        foreground: '#d7eee3',
        cursor: '#3dba8c',
        selectionBackground: '#1a3329'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current)
    fit.fit()

    // Fresh id per mount so StrictMode remounts / server switches cannot
    // race two shells onto the same map key.
    const id = `term-${serverId}-${Math.random().toString(36).slice(2, 9)}`
    let disposed = false

    const start = async () => {
      const dims = fit.proposeDimensions()
      try {
        await window.api.terminal.open(serverId, id, {
          cols: dims?.cols || 120,
          rows: dims?.rows || 30,
          su
        })
      } catch {
        return
      }
      if (disposed) {
        await window.api.terminal.close(id)
        return
      }
      term.focus()
    }

    start()

    const unsubData = window.api.terminal.onData((payload) => {
      if (payload.termId === id) {
        term.write(fromBase64(payload.data))
      }
    })

    const unsubClosed = window.api.terminal.onClosed((payload) => {
      if (payload.termId === id) {
        term.writeln('\r\n\x1b[90m[session closed]\x1b[0m')
      }
    })

    term.onData((data) => {
      window.api.terminal.input(id, toBase64(data))
    })

    const onResize = () => {
      fit.fit()
      window.api.terminal.resize(id, term.cols, term.rows)
    }
    window.addEventListener('resize', onResize)
    const ro = new ResizeObserver(onResize)
    ro.observe(containerRef.current)

    return () => {
      disposed = true
      unsubData()
      unsubClosed()
      window.removeEventListener('resize', onResize)
      ro.disconnect()
      window.api.terminal.close(id)
      term.dispose()
    }
  }, [serverId, su])

  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="terminal-wrap" ref={containerRef} />
    </div>
  )
}
