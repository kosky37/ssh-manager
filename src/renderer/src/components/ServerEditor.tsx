import { useState } from 'react'
import type { ServerInfo, ServerInput } from '../types'
import { errorMessage } from '../lib/format'
import { Icon, Modal, Spinner } from './ui'

export type EditorState =
  | { mode: 'add' }
  | { mode: 'edit'; server: ServerInfo }
  | { mode: 'duplicate'; server: ServerInfo }

interface Props {
  state: EditorState
  onClose: () => void
  onSaved: (server: ServerInfo) => void
}

function initialForm(state: EditorState): ServerInput {
  if (state.mode === 'add') {
    return {
      name: '',
      host: '',
      port: 22,
      username: 'root',
      authType: 'password',
      password: '',
      privateKeyPath: '',
      passphrase: '',
      elevate: false
    }
  }
  const s = state.server
  return {
    id: state.mode === 'edit' ? s.id : undefined,
    name: state.mode === 'duplicate' ? `${s.name} copy` : s.name,
    host: s.host,
    port: s.port,
    username: s.username,
    authType: s.authType,
    password: state.mode === 'edit' ? undefined : '',
    privateKeyPath: s.privateKeyPath || '',
    passphrase: state.mode === 'edit' ? undefined : '',
    elevate: s.elevate
  }
}

export default function ServerEditor({ state, onClose, onSaved }: Props) {
  const [form, setForm] = useState<ServerInput>(() => initialForm(state))
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const editing = state.mode === 'edit'
  const existing = state.mode === 'edit' ? state.server : null

  const set = <K extends keyof ServerInput>(key: K, value: ServerInput[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    setTestResult(null)
  }

  const errors: string[] = []
  if (!form.host.trim()) errors.push('Host is required')
  if (!form.username.trim()) errors.push('Username is required')
  if (form.authType === 'privateKey' && !form.privateKeyPath?.trim()) {
    errors.push('Choose a private key file')
  }
  const port = Number(form.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('Port must be 1–65535')
  const valid = errors.length === 0

  const payload = (): ServerInput => ({
    ...form,
    port,
    name: form.name.trim() || form.host.trim(),
    passphrase: form.authType === 'privateKey' ? form.passphrase : ''
  })

  const test = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await window.api.servers.test(payload())
      setTestResult(
        res.ok
          ? { ok: true, message: 'Connection successful' }
          : { ok: false, message: res.error }
      )
    } catch (e) {
      setTestResult({ ok: false, message: errorMessage(e) })
    } finally {
      setTesting(false)
    }
  }

  const submit = async () => {
    if (!valid) return
    setSaving(true)
    try {
      const saved = await window.api.servers.upsert(payload())
      onSaved(saved)
    } catch (e) {
      setTestResult({ ok: false, message: errorMessage(e) })
      setSaving(false)
    }
  }

  const browseKey = async () => {
    const path = await window.api.servers.pickKey()
    if (path) set('privateKeyPath', path)
  }

  const title =
    state.mode === 'add' ? 'Add server' : state.mode === 'edit' ? 'Edit server' : 'Duplicate server'

  return (
    <Modal
      title={title}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button
            type="button"
            className="btn"
            disabled={!valid || testing}
            onClick={test}
            style={{ marginRight: 'auto' }}
          >
            {testing ? <Spinner /> : <Icon name="zap" size={14} />}
            Test connection
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="server-form"
            className="btn primary"
            disabled={!valid || saving}
          >
            {editing ? 'Save' : 'Add server'}
          </button>
        </>
      }
    >
      <form
        id="server-form"
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label className="field span-2">
          <span>Display name</span>
          <input
            type="text"
            value={form.name}
            placeholder={form.host || 'My server'}
            onChange={(e) => set('name', e.target.value)}
          />
        </label>

        <label className="field">
          <span>Host</span>
          <input
            type="text"
            value={form.host}
            placeholder="192.168.1.10 or host.example.com"
            onChange={(e) => set('host', e.target.value)}
            spellCheck={false}
          />
        </label>
        <label className="field field-port">
          <span>Port</span>
          <input
            type="number"
            min={1}
            max={65535}
            value={form.port}
            onChange={(e) => set('port', Number(e.target.value))}
          />
        </label>

        <label className="field span-2">
          <span>Username</span>
          <input
            type="text"
            value={form.username}
            onChange={(e) => {
              const username = e.target.value
              setForm((f) => ({
                ...f,
                username,
                elevate:
                  username.trim() === 'root'
                    ? false
                    : f.username.trim() === 'root'
                      ? true
                      : f.elevate
              }))
            }}
            spellCheck={false}
          />
        </label>

        <div className="field span-2">
          <span>Authentication</span>
          <div className="segmented">
            <button
              type="button"
              className={form.authType === 'password' ? 'active' : ''}
              onClick={() => set('authType', 'password')}
            >
              <Icon name="key" size={14} /> Password
            </button>
            <button
              type="button"
              className={form.authType === 'privateKey' ? 'active' : ''}
              onClick={() => set('authType', 'privateKey')}
            >
              <Icon name="shield" size={14} /> Private key
            </button>
          </div>
        </div>

        {form.authType === 'password' ? (
          <label className="field span-2">
            <span>Password</span>
            <div className="input-group">
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.password ?? ''}
                placeholder={
                  existing?.hasPassword && form.password === undefined
                    ? 'Saved — leave empty to keep'
                    : ''
                }
                onChange={(e) => set('password', e.target.value === '' && existing?.hasPassword ? undefined : e.target.value)}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((v) => !v)}
              >
                <Icon name={showPassword ? 'eyeOff' : 'eye'} />
              </button>
            </div>
          </label>
        ) : (
          <>
            <label className="field span-2">
              <span>Private key file</span>
              <div className="input-group">
                <input
                  type="text"
                  value={form.privateKeyPath ?? ''}
                  placeholder="C:\Users\you\.ssh\id_ed25519"
                  onChange={(e) => set('privateKeyPath', e.target.value)}
                  spellCheck={false}
                />
                <button type="button" className="btn small" onClick={browseKey}>
                  Browse…
                </button>
              </div>
            </label>
            <label className="field span-2">
              <span>Key passphrase (optional)</span>
              <input
                type="password"
                value={form.passphrase ?? ''}
                placeholder={
                  existing?.hasPassphrase && form.passphrase === undefined
                    ? 'Saved — leave empty to keep'
                    : ''
                }
                onChange={(e) => set('passphrase', e.target.value === '' && existing?.hasPassphrase ? undefined : e.target.value)}
              />
            </label>
            <label className="field span-2">
              <span>Sudo password (optional)</span>
              <input
                type="password"
                value={form.password ?? ''}
                placeholder={
                  existing?.hasPassword && form.password === undefined
                    ? 'Saved — leave empty to keep'
                    : 'Used for sudo prompts'
                }
                onChange={(e) => set('password', e.target.value === '' && existing?.hasPassword ? undefined : e.target.value)}
              />
            </label>
          </>
        )}

        {form.username.trim() !== 'root' && (
          <label className="check span-2">
            <input
              type="checkbox"
              checked={!!form.elevate}
              onChange={(e) => set('elevate', e.target.checked)}
            />
            <span>
              Open terminals as root
              <small>Runs sudo -i and answers the prompt with the saved password.</small>
            </span>
          </label>
        )}

        {testResult && (
          <div className={`inline-result span-2 ${testResult.ok ? 'ok' : 'bad'}`}>
            <Icon name={testResult.ok ? 'check' : 'alert'} size={14} />
            {testResult.message}
          </div>
        )}
      </form>
    </Modal>
  )
}
