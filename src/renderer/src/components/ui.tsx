import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'

const ICONS = {
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  terminal: 'M4 17l6-6-6-6M12 19h8',
  docker:
    'M3 13h18M5 13v4a3 3 0 0 0 3 3h8a5 5 0 0 0 5-5v-2M6 9h3v4H6zM10 9h3v4h-3zM14 9h3v4h-3zM10 5h3v4h-3z',
  network:
    'M12 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM5 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 9v3M12 12l-5.5 3.5M12 12l5.5 3.5',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5',
  power: 'M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  x: 'M18 6L6 18M6 6l12 12',
  chevronLeft: 'M15 18l-6-6 6-6',
  chevronRight: 'M9 18l6-6-6-6',
  chevronDown: 'M6 9l6 6 6-6',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  more: 'M12 5.5v.01M12 12v.01M12 18.5v.01',
  keyboard:
    'M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10',
  sidebar: 'M3 4h18v16H3zM9 4v16',
  play: 'M6 4l14 8-14 8z',
  stop: 'M6 6h12v12H6z',
  restart: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  logs: 'M4 6h16M4 12h16M4 18h10',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff:
    'M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.4 3.3M6.6 6.6C3.9 8.3 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2',
  filePlus: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M12 12v6M9 15h6',
  folderPlus:
    'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 10v6M9 13h6',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  arrowLeft: 'M19 12H5M12 19l-7-7 7-7',
  arrowRight: 'M5 12h14M12 5l7 7-7 7',
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
  server: 'M3 4h18v7H3zM3 13h18v7H3zM7 7.5h.01M7 16.5h.01',
  key: 'M15 7a4 4 0 1 1-4 4M11 11l-8 8M6 16l2 2M8 14l2 2',
  check: 'M20 6L9 17l-5-5',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  import: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  external: 'M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  zap: 'M13 2L3 14h9l-1 8 10-12h-9z'
} as const

export type IconName = keyof typeof ICONS

export function Icon({
  name,
  size = 16,
  className
}: {
  name: IconName
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`icon${className ? ` ${className}` : ''}`}
      aria-hidden
    >
      <path d={ICONS[name]} />
    </svg>
  )
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="Loading" />
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}

export function Meter({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value))
  const level = pct >= 90 ? 'level-high' : pct >= 70 ? 'level-mid' : 'level-low'
  return (
    <div className={`meter ${level}${className ? ` ${className}` : ''}`}>
      <div className="meter-fill" style={{ width: `${pct}%` }} />
    </div>
  )
}

type ToastKind = 'success' | 'error' | 'info'

interface ToastOptions {
  kind?: ToastKind
  title: string
  detail?: string
  action?: { label: string; onClick: () => void }
  duration?: number
}

interface ToastItem extends ToastOptions {
  id: number
}

const ToastContext = createContext<(opts: ToastOptions) => void>(() => undefined)

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (opts: ToastOptions) => {
      const id = nextId.current++
      const kind = opts.kind || 'info'
      setItems((list) => [...list.slice(-4), { ...opts, kind, id }])
      const duration = opts.duration ?? (kind === 'error' ? 9000 : opts.action ? 7000 : 3500)
      if (duration > 0) setTimeout(() => dismiss(id), duration)
    },
    [dismiss]
  )

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <Icon
              name={t.kind === 'success' ? 'check' : t.kind === 'error' ? 'alert' : 'info'}
              className="toast-icon"
            />
            <div className="toast-body">
              <div className="toast-title">{t.title}</div>
              {t.detail && <div className="toast-detail">{t.detail}</div>}
            </div>
            {t.action && (
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  t.action!.onClick()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 440
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>(
      '[data-autofocus], input:not([type=hidden]), select, textarea, button.primary'
    )
    first?.focus()
    if (first instanceof HTMLInputElement) first.select()
    return () => previous?.focus?.()
  }, [])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} ref={ref} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmLabel?: string
  danger?: boolean
}

interface PromptOptions {
  title: string
  label?: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  selectStem?: boolean
  validate?: (value: string) => string | null
}

interface DialogApi {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  prompt: (opts: PromptOptions) => Promise<string | null>
}

const DialogContext = createContext<DialogApi>({
  confirm: async () => false,
  prompt: async () => null
})

export function useDialog() {
  return useContext(DialogContext)
}

type DialogState =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void }

function PromptBody({
  opts,
  onSubmit,
  onCancel
}: {
  opts: PromptOptions
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(opts.defaultValue || '')
  const [touched, setTouched] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const error = opts.validate ? opts.validate(value) : value.trim() ? null : 'Required'

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    requestAnimationFrame(() => {
      input.focus()
      if (opts.selectStem) {
        const dot = value.lastIndexOf('.')
        input.setSelectionRange(0, dot > 0 ? dot : value.length)
      } else {
        input.select()
      }
    })
  }, [])

  return (
    <Modal
      title={opts.title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            form="prompt-form"
            className="btn primary"
            disabled={!!error}
          >
            {opts.confirmLabel || 'OK'}
          </button>
        </>
      }
    >
      <form
        id="prompt-form"
        onSubmit={(e) => {
          e.preventDefault()
          setTouched(true)
          if (!error) onSubmit(value)
        }}
      >
        <label className="field">
          {opts.label && <span>{opts.label}</span>}
          <input
            ref={inputRef}
            type="text"
            value={value}
            placeholder={opts.placeholder}
            onChange={(e) => {
              setTouched(true)
              setValue(e.target.value)
            }}
            spellCheck={false}
          />
        </label>
        {touched && error && <div className="field-error">{error}</div>}
      </form>
    </Modal>
  )
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null)

  const api: DialogApi = {
    confirm: useCallback(
      (opts) => new Promise<boolean>((resolve) => setState({ kind: 'confirm', opts, resolve })),
      []
    ),
    prompt: useCallback(
      (opts) => new Promise<string | null>((resolve) => setState({ kind: 'prompt', opts, resolve })),
      []
    )
  }

  const close = (value: boolean | string | null) => {
    if (!state) return
    if (state.kind === 'confirm') state.resolve(value === true)
    else state.resolve(typeof value === 'string' ? value : null)
    setState(null)
  }

  return (
    <DialogContext.Provider value={api}>
      {children}
      {state?.kind === 'confirm' && (
        <Modal
          title={state.opts.title}
          onClose={() => close(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => close(false)}>
                Cancel
              </button>
              <button
                type="button"
                data-autofocus
                className={`btn ${state.opts.danger ? 'danger-solid' : 'primary'}`}
                onClick={() => close(true)}
              >
                {state.opts.confirmLabel || 'Confirm'}
              </button>
            </>
          }
        >
          {state.opts.message && <div className="confirm-message">{state.opts.message}</div>}
        </Modal>
      )}
      {state?.kind === 'prompt' && (
        <PromptBody
          opts={state.opts}
          onSubmit={(value) => close(value)}
          onCancel={() => close(null)}
        />
      )}
    </DialogContext.Provider>
  )
}

export interface MenuItem {
  label: string
  icon?: IconName
  hint?: string
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

export type MenuEntry = MenuItem | 'separator'

export function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: MenuEntry[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({
      x: Math.min(x, window.innerWidth - rect.width - 8),
      y: Math.min(y, window.innerHeight - rect.height - 8)
    })
  }, [x, y])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={`sep-${i}`} className="context-menu-sep" />
        ) : (
          <button
            key={item.label}
            type="button"
            className={item.danger ? 'danger' : undefined}
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            <span className="context-menu-label">
              {item.icon && <Icon name={item.icon} size={14} />}
              {item.label}
            </span>
            {item.hint && <span className="context-menu-hint">{item.hint}</span>}
          </button>
        )
      )}
    </div>
  )
}

export function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null)
  const close = useCallback(() => setMenu(null), [])
  const open = useCallback((e: { clientX: number; clientY: number }, items: MenuEntry[]) => {
    setMenu({ x: e.clientX, y: e.clientY, items })
  }, [])
  const element = menu ? (
    <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={close} />
  ) : null
  return { open, close, element }
}

export function Switch({
  checked,
  onChange,
  disabled,
  label
}: {
  checked: boolean | null
  onChange: (value: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked === true}
      aria-label={label}
      disabled={disabled}
      className={`switch${checked ? ' on' : ''}${checked === null ? ' unknown' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  )
}
