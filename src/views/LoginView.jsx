import React, { useState } from "react";
import { Mail, KeyRound, Eye, EyeOff } from "lucide-react";
import { api, DEV_EMAIL } from "../api.js";
import { fontHead, inputClass, btnPrimary } from "../components.jsx";

export default function LoginView({ onLogin }) {
  const [mode, setMode] = useState("login"); // login | register
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    const trimmedEmail = email.trim();

    // Developer backdoor: dev@dlvrd.app signs in via the dev endpoint so the
    // returned session carries isDev + the impersonated role (the header switcher
    // handles jumping to other roles after login).
    if (trimmedEmail.toLowerCase() === DEV_EMAIL) {
      if (!password) {
        setError("Developer password is required.");
        return;
      }
      setBusy(true);
      try {
        const data = await api.loginDev(DEV_EMAIL, password, "admin");
        onLogin(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (mode === "register") {
      if (!name.trim() || !trimmedEmail || password.length < 6) {
        setError("Name, a valid email, and a password of at least 6 characters are required.");
        return;
      }
      setBusy(true);
      try {
        const data = await api.register(name.trim(), trimmedEmail, password);
        onLogin(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
      return;
    }

    // Everyone else: one plain form, the server works out the user type.
    if (!trimmedEmail || !password) {
      setError("Email and password are required.");
      return;
    }
    setBusy(true);
    try {
      const data = await api.loginAny(trimmedEmail, password);
      onLogin(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md mx-auto mt-12">
      <div className="flex items-center justify-center gap-2 mb-6">
        <div className="h-10 w-10 rounded-md flex items-center justify-center" style={{ color: '#ffffff' }}>
          <svg width="40" height="40" viewBox="0 0 64 64" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 30h8M6 40h8" stroke="#12b76a" strokeWidth="4"/>
            <rect x="18" y="24" width="40" height="32" rx="7" stroke="#ffffff" strokeWidth="4"/>
            <path d="M24 24l6-8h18l6 8" stroke="#ffffff" strokeWidth="4"/>
            <path d="M34 46L46 34m0 0h-8m8 0v8" stroke="#12b76a" strokeWidth="4"/>
          </svg>
        </div>
        <div>
          <div className="text-xl font-semibold leading-none" style={fontHead}>
            Delive<span style={{ color: '#12b76a' }}>ree</span>
          </div>
          <div className="text-xs text-slate-500 leading-none mt-1">
            delivery dispatch
          </div>
        </div>
      </div>

      <h1 className="text-2xl font-semibold mb-1 text-center" style={fontHead}>
        Sign in
      </h1>
      <p className="text-slate-400 text-sm mb-6 text-center">
        Enter your email and password to log in.
      </p>

      <form
        onSubmit={submit}
        className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4"
      >
        {mode === "register" && (
          <div>
            <label className="block text-sm text-slate-400 mb-1 flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 text-blue-400" /> Full name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Dana Alleyne"
              className={inputClass}
            />
          </div>
        )}

        <div>
          <label className="block text-sm text-slate-400 mb-1 flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5 text-blue-400" /> Email
          </label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="username"
            placeholder="you@example.com"
            className={inputClass}
          />
        </div>

        <div>
          <label className="block text-sm text-slate-400 mb-1 flex items-center gap-1.5">              <KeyRound className="h-3.5 w-3.5 text-emerald-400" /> Password
          </label>
          <div className="relative">
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder={mode === "register" ? "At least 6 characters" : "••••••••"}
              className={inputClass + " pr-10"}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              title={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-400 bg-red-950/40 border border-red-900/60 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} className={btnPrimary + " w-full"}>
          {busy
            ? "Signing in…"
            : mode === "register"
            ? "Create account"
            : "Sign in"}
        </button>

        {mode === "register" && (
          <p className="text-center text-xs text-slate-500">
            Already have an account?{" "}
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError("");
              }}
              className="text-emerald-400 hover:text-emerald-300"
            >
              Sign in
            </button>
          </p>
        )}

        {mode === "login" && (
          <p className="text-center text-xs text-slate-500">
            New here?{" "}
            <button
              type="button"
              onClick={() => {
                setMode("register");
                setError("");
              }}
              className="text-emerald-400 hover:text-emerald-300"
            >
              Create a customer account
            </button>
          </p>
        )}
      </form>
    </div>
  );
}
