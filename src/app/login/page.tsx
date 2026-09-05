"use client";

/**
 * Login screen (Phase 2). First credentials are seeded from the deployment
 * env (AUTH_USERNAME / AUTH_PASSWORD, documented defaults admin/admin) and
 * can be changed in Settings > Security after signing in.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error || `Login failed (${res.status})`);
        setBusy(false);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setBusy(false);
    }
  }

  const input =
    "h-11 w-full rounded border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-teal-600 focus:outline-none";

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-2xl font-semibold tracking-wide">
            <span className="text-teal-400">DICOM</span>
            <span className="text-zinc-200">Viewer</span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Sign in to read studies from your PACS
          </p>
        </div>

        <form
          onSubmit={submit}
          className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-5"
        >
          <div className="space-y-1.5">
            <label htmlFor="login-user" className="text-xs text-zinc-400">
              Username
            </label>
            <input
              id="login-user"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              className={input}
              placeholder="admin"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="login-pass" className="text-xs text-zinc-400">
              Password
            </label>
            <input
              id="login-pass"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className={input}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="rounded bg-rose-950/60 px-3 py-2 text-xs text-rose-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="h-10 w-full rounded bg-teal-600 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] leading-4 text-zinc-600">
          First login: the credentials from your deployment .env
          <br />
          (AUTH_USERNAME / AUTH_PASSWORD). Change them in Settings.
        </p>
      </div>
    </div>
  );
}
