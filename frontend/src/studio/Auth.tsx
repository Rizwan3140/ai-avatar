import { useState } from 'react'
import { api, setToken, type Principal } from './api.ts'

/**
 * Sign in, or create the first account on this machine.
 *
 * One form, two meanings, decided by the server rather than by a link the user
 * has to find. A fresh install has no accounts and shows "create"; the moment one
 * exists it shows "sign in" and never offers creation again — further accounts
 * come from an owner, on the Team screen.
 */
export function Auth({ open, onSignedIn }: { open: boolean; onSignedIn: (who: Principal) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [org, setOrg] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await api<Principal & { token: string }>(
        open ? '/api/auth/signup' : '/api/auth/login',
        { method: 'POST', body: open ? { email, password, org_name: org } : { email, password } },
      )
      setToken(result.token)
      onSignedIn(result)
    } catch (problem) {
      setError((problem as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-canvas text-ink grid min-h-full place-items-center px-6">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">
            {open ? 'Create the first account' : 'Avatar Studio'}
          </h1>
          <p className="text-ink-soft text-sm">
            {open
              ? 'This machine has no accounts yet, so anyone on the network can change it. Creating one closes that for good.'
              : 'Sign in to manage avatars, catalogs and cabinets.'}
          </p>
        </div>

        {open && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium" style={{ color: 'var(--s-muted)' }}>Company</span>
            <input
              className="input"
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              placeholder="Northwind Retail"
              autoComplete="organization"
            />
          </label>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium" style={{ color: 'var(--s-muted)' }}>Email</span>
          <input
            className="input"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium" style={{ color: 'var(--s-muted)' }}>Password</span>
          <input
            className="input"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={open ? 'new-password' : 'current-password'}
          />
          {open && (
            <span className="text-ink-soft text-xs">At least ten characters.</span>
          )}
        </label>

        {error && (
          <p role="alert" className="rounded border border-line bg-white px-3 py-2 text-sm text-amber-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="bg-ink rounded px-4 py-2.5 text-sm font-medium text-white transition-opacity disabled:opacity-40"
        >
          {busy ? 'Working…' : open ? 'Create account' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
