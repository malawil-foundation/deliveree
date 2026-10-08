import React, { useState, useEffect } from "react";
import {
  Users,
  Shield,
  Trash2,
  BarChart3,
  Plus,
  X,
  DollarSign,
  Wallet,
  Download,
  Truck,
  Package,
  MapPin,
  Pencil,
  AlertTriangle,
  KeyRound,
  ScrollText,
} from "lucide-react";
import { api } from "../api.js";
import {
  fontHead,
  fontMono,
  StatusBadge,
  StatBlock,
  inputClass,
  btnPrimary,
  btnGhost,
  formatLoc,
  fmtTime,
} from "../components.jsx";

const TABS = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "users", label: "Users", icon: Users },
  { id: "drivers", label: "Drivers", icon: Truck },
  { id: "orders", label: "Orders", icon: Package },
  { id: "payouts", label: "Payouts", icon: DollarSign },
  { id: "audit", label: "Audit log", icon: ScrollText },
];

export default function AdminView({ token, orders, drivers, onDataChanged }) {
  const [tab, setTab] = useState("overview");
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [events, setEvents] = useState(null);

  async function loadAdminData() {
    const [s, u, ev] = await Promise.all([
      api.admin.stats(token),
      api.admin.users(token),
      api.admin.userEvents(token),
    ]);
    setStats(s);
    setUsers(u);
    setEvents(ev);
  }

  useEffect(() => {
    loadAdminData().catch((e) => alert(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function refresh() {
    await Promise.all([loadAdminData(), onDataChanged()]);
  }

  async function run(fn) {
    try {
      await fn();
      await refresh();
      return true;
    } catch (e) {
      alert(e.message);
      return false;
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold flex items-center gap-2" style={fontHead}>
          <Shield className="h-5 w-5 text-emerald-400" /> Admin panel
        </h1>
        <div className="flex bg-slate-900 border border-slate-800 rounded-full p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={
                "px-3 py-1.5 text-sm rounded-full transition-colors flex items-center gap-1.5 " +
                (tab === t.id
                  ? "bg-emerald-500 text-slate-950 font-medium"
                  : "text-slate-400 hover:text-slate-200")
              }
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "overview" && <OverviewTab stats={stats} orders={orders} />}
      {tab === "users" && (
        <UsersTab token={token} users={users} drivers={drivers} run={run} />
      )}
      {tab === "drivers" && (
        <DriversTab token={token} drivers={drivers} run={run} />
      )}
      {tab === "orders" && (
        <OrdersTab token={token} orders={orders} drivers={drivers} run={run} />
      )}
      {tab === "payouts" && <PayoutsTab token={token} drivers={drivers} />}
      {tab === "audit" && <AuditTab events={events} />}
    </div>
  );
}

// ---------------- OVERVIEW ----------------
function OverviewTab({ stats, orders }) {
  const recent = orders.slice(0, 6);
  return (
    <div>
      <div className="flex flex-wrap gap-4 mb-6">
        <StatBlock label="Total orders" value={stats?.orders.total ?? "—"} />
        <StatBlock label="Completed" value={stats?.orders.byStatus?.completed ?? 0} />
        <StatBlock label="Revenue (completed)" value={`$${(stats?.revenue ?? 0).toFixed(2)}`} />
        <StatBlock label="Outstanding payments" value={`$${(stats?.outstanding ?? 0).toFixed(2)}`} />
        <StatBlock label="User accounts" value={stats?.users.total ?? "—"} />
        <StatBlock label="Active drivers" value={stats?.drivers.active ?? "—"} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4" style={fontHead}>
            Orders by status
          </h3>
          <div className="space-y-3">
            {Object.entries(stats?.orders.byStatus ?? {}).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between">
                <StatusBadge status={status} />
                <span className="text-sm font-medium" style={fontHead}>{count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4" style={fontHead}>
            Users by role
          </h3>
          <div className="space-y-3">
            {Object.entries(stats?.users.byRole ?? {}).map(([role, count]) => (
              <div key={role} className="flex items-center justify-between">
                <span className="text-sm capitalize text-slate-300">{role}</span>
                <span className="text-sm font-medium" style={fontHead}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <h3 className="text-sm font-semibold text-slate-300 mt-6 mb-3" style={fontHead}>
        Recent orders
      </h3>
      <div className="space-y-2">
        {recent.map((o) => (
          <div
            key={o.id}
            className="bg-slate-900 border border-slate-800 rounded-md p-3 flex items-center gap-3"
          >
            <span className="text-xs text-slate-500" style={fontMono}>{o.id}</span>
            <span className="text-sm text-slate-300 flex-1 truncate">
              {o.customerName}
            </span>
            <span className="text-xs text-slate-500 hidden md:block truncate">
              {formatLoc(o.pickupAddress, o.pickupParish)} →{" "}
              {formatLoc(o.dropoffAddress, o.dropoffParish)}
            </span>
            <StatusBadge status={o.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- USERS ----------------
function UsersTab({ token, users, drivers, run }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "customer" });
  const [editingId, setEditingId] = useState(null);
  const [resettingId, setResettingId] = useState(null);

  function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || form.password.length < 6) return;
    run(() => api.admin.createUser(token, form)).then(() =>
      setForm({ name: "", email: "", password: "", role: "customer" })
    );
  }

  return (
    <div>
      <form
        onSubmit={submit}
        className="bg-slate-900 border border-slate-800 rounded-lg p-4 grid md:grid-cols-5 gap-3 mb-6"
      >
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Full name"
          className={inputClass}
        />
        <input
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          type="email"
          placeholder="email@example.com"
          className={inputClass}
        />
        <input
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          type="text"
          placeholder="Password (6+ chars)"
          className={inputClass}
        />
        <select
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
          className={inputClass}
        >
          <option value="customer">Customer</option>
          <option value="dispatcher">Dispatcher</option>
          <option value="driver">Driver</option>
          <option value="admin">Admin</option>
        </select>
        <button type="submit" className={btnPrimary + " flex items-center justify-center gap-1.5"}>
          <Plus className="h-4 w-4" /> Add user
        </button>
      </form>

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-800">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const editing = editingId === u.id;
              const resetting = resettingId === u.id;
              return (
                <React.Fragment key={u.id}>
                  <tr className="border-b border-slate-800/60 last:border-0">
                    <td className="px-4 py-3 text-slate-200">{u.name}</td>
                    <td className="px-4 py-3 text-slate-400">{u.email}</td>
                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        onChange={(e) =>
                          run(() => api.admin.updateUser(token, u.id, { role: e.target.value }))
                        }
                        className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="customer">Customer</option>
                        <option value="dispatcher">Dispatcher</option>
                        <option value="driver">Driver</option>
                        <option value="admin">Admin</option>
                      </select>
                      {u.role === "driver" && (
                        <div className="mt-1.5">
                          <div className="text-[10px] uppercase tracking-wide text-slate-600 mb-0.5">
                            Fleet driver
                          </div>
                          <select
                            value={u.fleetDriverId || ""}
                            onChange={(e) =>
                              run(() =>
                                api.admin.updateUser(token, u.id, {
                                  fleetDriverId: e.target.value || null,
                                })
                              )
                            }
                            className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] w-full focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            title="Which fleet driver this login drives — each fleet driver can back at most one login"
                          >
                            <option value="">Not linked</option>
                            {drivers.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name} · {d.vehicle}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => {
                          setEditingId(null);
                          setResettingId((id) => (id === u.id ? null : u.id));
                        }}
                        className={
                          "text-slate-500 hover:text-emerald-400 transition-colors mr-3 " +
                          (resetting ? "text-emerald-400" : "")
                        }
                        title="Reset password without the current one"
                      >
                        <KeyRound className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => {
                          setResettingId(null);
                          setEditingId((id) => (id === u.id ? null : u.id));
                        }}
                        className={
                          "text-slate-500 hover:text-emerald-400 transition-colors mr-3 " +
                          (editing ? "text-emerald-400" : "")
                        }
                        title="Edit name / email / password"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete ${u.name}?`)) {
                            run(() => api.admin.deleteUser(token, u.id));
                          }
                        }}
                        className="text-red-400 hover:text-red-300"
                        title="Delete user"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                  {resetting && (
                    <tr className="border-b border-slate-800/60 bg-slate-950/50">
                      <td colSpan={4} className="px-4 py-3">
                        <ResetPasswordRow
                          user={u}
                          token={token}
                          run={run}
                          onDone={() => setResettingId(null)}
                        />
                      </td>
                    </tr>
                  )}
                  {editing && (
                    <tr className="border-b border-slate-800/60 bg-slate-950/50">
                      <td colSpan={4} className="px-4 py-3">
                        <UserEditRow user={u} token={token} run={run} onDone={() => setEditingId(null)} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserEditRow({ user, token, run, onDone }) {
  const [form, setForm] = useState({
    name: user.name,
    email: user.email,
    password: "",
  });
  const dirty =
    form.name.trim() !== user.name ||
    form.email.trim() !== user.email ||
    form.password !== "";
  const valid =
    form.name.trim() !== "" &&
    form.email.trim() !== "" &&
    (form.password === "" || form.password.length >= 6);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!dirty || !valid) return;
        const patch = { name: form.name.trim(), email: form.email.trim() };
        if (form.password) patch.password = form.password;
        run(() => api.admin.updateUser(token, user.id, patch)).then(onDone);
      }}
      className="grid md:grid-cols-4 gap-3 items-center"
    >
      <input
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        placeholder="Full name"
        className={inputClass}
      />
      <input
        value={form.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
        type="email"
        placeholder="email@example.com"
        className={inputClass}
      />
      <input
        value={form.password}
        onChange={(e) => setForm({ ...form, password: e.target.value })}
        type="text"
        placeholder="New password (6+ chars)"
        className={inputClass}
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!dirty || !valid}
          className={
            btnPrimary + " disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-500"
          }
        >
          Save
        </button>
        <button
          type="button"
          onClick={onDone}
          className="text-xs text-slate-400 hover:text-slate-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------- DRIVERS ----------------
const EMPTY_DRIVER = {
  userId: "",
  vehicle: "",
  regNumber: "",
  model: "",
  colour: "",
  description: "",
};

function DriversTab({ token, drivers, run }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_DRIVER);
  const [editingId, setEditingId] = useState(null);
  const [eligibleUsers, setEligibleUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  async function openAdd() {
    setShowAdd((v) => {
      if (v) { setForm(EMPTY_DRIVER); return false; }
      return true;
    });
    if (!showAdd) {
      setLoadingUsers(true);
      try {
        const users = await api.eligibleDriverUsers(token);
        setEligibleUsers(users);
      } catch {
        setEligibleUsers([]);
      } finally {
        setLoadingUsers(false);
      }
    }
  }

  function reset() {
    setForm(EMPTY_DRIVER);
    setShowAdd(false);
    setEligibleUsers([]);
  }

  return (
    <div>
      <button
        onClick={openAdd}
        className="mb-4 flex items-center gap-1.5 text-xs border border-slate-800 hover:border-slate-700 rounded-md px-3 py-2 text-slate-400 hover:text-slate-200 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" /> Add fleet driver
      </button>
      {showAdd && (
        <div className="bg-slate-900 border border-slate-800 rounded-md p-4 mb-6">
          {loadingUsers ? (
            <p className="text-xs text-slate-500">Loading driver accounts…</p>
          ) : eligibleUsers.length === 0 ? (
            <p className="text-xs text-slate-500">
              No unlinked driver accounts available. Create a user with the{" "}
              <span className="text-slate-300">Driver</span> role first, then
              add them here.
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!form.userId) return;
                run(() =>
                  api.addDriver(token, {
                    userId: form.userId,
                    vehicle: form.vehicle.trim() || "Vehicle",
                    regNumber: form.regNumber.trim() || null,
                    model: form.model.trim() || null,
                    colour: form.colour.trim() || null,
                    description: form.description.trim() || null,
                  })
                );
                reset();
              }}
              className="grid md:grid-cols-6 gap-3"
            >
              <div className="md:col-span-2 flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wide text-slate-500">
                  Driver account
                </label>
                <select
                  value={form.userId}
                  onChange={(e) => setForm({ ...form, userId: e.target.value })}
                  required
                  className={inputClass}
                >
                  <option value="">— select user —</option>
                  {eligibleUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {u.email}
                    </option>
                  ))}
                </select>
              </div>
              <input
                value={form.vehicle}
                onChange={(e) => setForm({ ...form, vehicle: e.target.value })}
                placeholder="Vehicle type"
                className={inputClass}
              />
              <input
                value={form.regNumber}
                onChange={(e) => setForm({ ...form, regNumber: e.target.value })}
                placeholder="Reg number"
                className={inputClass}
                style={fontMono}
              />
              <input
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="Model"
                className={inputClass}
              />
              <input
                value={form.colour}
                onChange={(e) => setForm({ ...form, colour: e.target.value })}
                placeholder="Colour"
                className={inputClass}
              />
              <button type="submit" className={btnPrimary} disabled={!form.userId}>
                Add
              </button>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Description (optional)"
                className={inputClass + " md:col-span-5"}
              />
            </form>
          )}
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-800">
              <th className="px-4 py-3">Driver</th>
              <th className="px-4 py-3">Vehicle</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Stops</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {drivers.map((d) => {
              const pending = d.stops.filter((s) => !s.done).length;
              const displayStatus =
                d.displayStatus ||
                (pending > 0 ? "on-route" : d.status === "off-duty" ? "off-duty" : "available");
              const editing = editingId === d.id;
              return (
                <React.Fragment key={d.id}>
                  <tr className="border-b border-slate-800/60">
                    <td className="px-4 py-3 text-slate-200">{d.name}</td>
                    <td className="px-4 py-3 text-slate-400">
                      <div>{[d.vehicle, d.colour].filter(Boolean).join(" · ")}</div>
                      {(d.regNumber || d.model) && (
                        <div className="text-[11px] text-slate-600">
                          {[d.regNumber, d.model].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={displayStatus} />
                      {d.statusUpdatedAt && (
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          since {fmtTime(d.statusUpdatedAt)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {d.stops.length} ({pending} pending)
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setEditingId((id) => (id === d.id ? null : d.id))}
                        className={
                          "text-slate-500 hover:text-emerald-400 transition-colors " +
                          (editing ? "text-emerald-400" : "")
                        }
                        title="Edit driver"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                  {editing && (
                    <tr className="border-b border-slate-800/60 bg-slate-950/50">
                      <td colSpan={5} className="px-4 py-3">
                        <DriverEditRow driver={d} token={token} run={run} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DriverEditRow({ driver, token, run }) {
  const [form, setForm] = useState({
    name: driver.name,
    vehicle: driver.vehicle,
    regNumber: driver.regNumber || "",
    model: driver.model || "",
    colour: driver.colour || "",
    description: driver.description || "",
    feeOverride: driver.feePctOverride ?? "",
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!form.name.trim() || !form.vehicle.trim()) return;
        const feeRaw = String(form.feeOverride).trim();
        if (feeRaw !== "") {
          const n = Number(feeRaw);
          if (!Number.isFinite(n) || n < 0 || n > 100) return;
        }
        run(() =>
          api.updateDriver(token, driver.id, {
            name: form.name.trim(),
            vehicle: form.vehicle.trim(),
            regNumber: form.regNumber.trim() || null,
            model: form.model.trim() || null,
            colour: form.colour.trim() || null,
            description: form.description.trim() || null,
            // Admin-only on the server; empty string clears back to global rate.
            feePctOverride: feeRaw === "" ? null : Number(feeRaw),
          })
        );
      }}
      className="grid md:grid-cols-6 gap-3"
    >
      <input
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        className={inputClass}
        placeholder="Name"
      />
      <input
        value={form.vehicle}
        onChange={(e) => setForm({ ...form, vehicle: e.target.value })}
        className={inputClass}
        placeholder="Vehicle type"
      />
      <input
        value={form.regNumber}
        onChange={(e) => setForm({ ...form, regNumber: e.target.value })}
        className={inputClass}
        style={fontMono}
        placeholder="Reg number"
      />
      <input
        value={form.model}
        onChange={(e) => setForm({ ...form, model: e.target.value })}
        className={inputClass}
        placeholder="Model"
      />
      <input
        value={form.colour}
        onChange={(e) => setForm({ ...form, colour: e.target.value })}
        className={inputClass}
        placeholder="Colour"
      />
      <button type="submit" className={btnPrimary}>
        Save
      </button>
      <input
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        className={inputClass + " md:col-span-5"}
        placeholder="Description"
      />
      <div className="md:col-span-1 flex items-center gap-2">
        <input
          type="number"
          min="0"
          max="100"
          step="1"
          value={form.feeOverride}
          onChange={(e) => setForm({ ...form, feeOverride: e.target.value })}
          className={inputClass}
          placeholder="70"
          title="Fee % override — leave empty to use the global rate"
        />
        <span className="text-xs text-slate-500 shrink-0">%</span>
      </div>
      <p className="md:col-span-6 text-[11px] text-slate-600 -mt-1">
        Fee % override — what this driver earns per delivery. Leave empty to use
        the global rate (set in the Payouts tab). Applies to orders assigned
        from now on.
      </p>
    </form>
  );
}

// ---------------- ORDERS ----------------
function OrdersTab({ token, orders, drivers, run }) {
  return (
    <div className="space-y-3">
      {orders.length === 0 && (
        <p className="text-slate-500 text-sm border border-dashed border-slate-800 rounded-lg p-6 text-center">
          No orders yet.
        </p>
      )}
      {orders.map((o) => {
        const driver = drivers.find((d) => d.id === o.driverId);
        const cancellable = !["completed", "cancelled"].includes(o.status);
        return (
          <div
            key={o.id}
            className={
              "bg-slate-900 border rounded-lg p-4 " +
              (o.status === "cancel_requested"
                ? "border-orange-900/70"
                : "border-slate-800")
            }
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span style={fontMono}>{o.id}</span>
                <span>&middot;</span>
                <span>{o.customerName}</span>
                <span>&middot;</span>
                <span>{fmtTime(o.createdAt)}</span>
                {o.completedAt && (
                  <>
                    <span>&middot;</span>
                    <span className="text-emerald-400 font-medium">Completed {fmtTime(o.completedAt)}</span>
                  </>
                )}
              </div>
              <StatusBadge status={o.status} />
            </div>

            {o.status === "cancel_requested" && (
              <div className="flex items-center gap-1.5 text-xs text-orange-300 bg-orange-950/40 border border-orange-900/50 rounded px-2 py-1 mb-3">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Driver asked to cancel this job — approve it or reassign it.
              </div>
            )}

            <div className="space-y-1.5 mb-3">
              <div className="flex items-start gap-2 text-sm">
                <Package className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
                <span>{formatLoc(o.pickupAddress, o.pickupParish)}</span>
              </div>
              <div className="flex items-start gap-2 text-sm">
                <MapPin className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                <span>{formatLoc(o.dropoffAddress, o.dropoffParish)}</span>
              </div>
            </div>

            {driver && (
              <div className="text-xs text-slate-500 mb-2 flex items-center gap-1">
                <Truck className="h-3.5 w-3.5" /> {driver.name}
              </div>
            )}

            {o.cost != null && (
              <div className="text-xs text-slate-400 mb-3">
                Cost:{" "}
                <span className="text-slate-200 font-medium">
                  ${o.cost.toFixed(2)}
                </span>
              </div>
            )}

            <div className="flex items-center gap-3 flex-wrap">
              {o.status === "pending_review" && (
                <PriceInline token={token} order={o} run={run} />
              )}
              {o.status === "unassigned" && (
                <AssignInline token={token} order={o} drivers={drivers} run={run} />
              )}
              {o.status === "cancel_requested" && (
                <>
                  <button
                    onClick={() => {
                      if (confirm(`Approve the cancellation of ${o.id}?`)) {
                        run(() => api.approveCancel(token, o.id));
                      }
                    }}
                    className="text-xs bg-red-500/10 border border-red-900/60 text-red-300 hover:bg-red-500/20 rounded px-2 py-1.5 transition-colors"
                  >
                    Approve cancel
                  </button>
                  <AdminReassign token={token} order={o} drivers={drivers} run={run} />
                </>
              )}
              {cancellable && (
                <button
                  onClick={() => {
                    if (confirm(`Cancel ${o.id}?`)) {
                      run(() => api.cancelOrder(token, o.id));
                    }
                  }}
                  className="ml-auto text-xs text-red-400 hover:text-red-300"
                >
                  Cancel order
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AdminReassign({ token, order, drivers, run }) {
  const [driverId, setDriverId] = useState("");
  const options = drivers.filter(
    (d) => d.id !== order.driverId && d.status !== "off-duty"
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!driverId) return;
        run(() => api.reassignOrder(token, order.id, driverId));
        setDriverId("");
      }}
      className="flex items-center gap-1.5"
    >
      <select
        value={driverId}
        onChange={(e) => setDriverId(e.target.value)}
        className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
      >
        <option value="">Reassign to…</option>
        {options.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={!driverId}
        className="text-xs bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-medium rounded px-2 py-1.5 transition-colors"
      >
        Reassign
      </button>
    </form>
  );
}

function PriceInline({ token, order, run }) {
  const [cost, setCost] = useState("");
  const value = parseFloat(cost);
  const isValid = cost !== "" && !Number.isNaN(value) && value > 0;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!isValid) return;
        run(() => api.priceOrder(token, order.id, value));
        setCost("");
      }}
      className="flex items-center gap-2"
    >
      <div className="relative">
        <DollarSign className="h-3.5 w-3.5 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2" />
        <input
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          className="bg-slate-950 border border-slate-800 rounded-md pl-7 pr-2 py-1.5 text-xs w-24 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>
      <button
        type="submit"
        disabled={!isValid}
        className="text-xs bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-medium rounded-md px-3 py-1.5 transition-colors"
      >
        Approve price
      </button>
    </form>
  );
}

function AssignInline({ token, order, drivers, run }) {
  const [driverId, setDriverId] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!driverId) return;
        run(() => api.assignOrder(token, order.id, driverId));
        setDriverId("");
      }}
      className="flex items-center gap-2"
    >
      <select
        value={driverId}
        onChange={(e) => setDriverId(e.target.value)}
        className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
      >
        <option value="">Assign driver…</option>
        {drivers
          .filter((d) => d.status !== "off-duty")
          .map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.vehicle})
            </option>
          ))}
      </select>
      <button
        type="submit"
        disabled={!driverId}
        className="text-xs bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-medium rounded-md px-3 py-1.5 transition-colors"
      >
        Assign
      </button>
    </form>
  );
}

// ---------------- RESET PASSWORD ----------------
// Admin sets a brand-new password for a user — the current one is never needed or
// checked, so this works even if the user has lost access. Recorded in the audit
// log as a "Password reset" entry (the value itself is never stored there).
function ResetPasswordRow({ user, token, run, onDone }) {
  const [password, setPassword] = useState("");
  const valid = password.length >= 6;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        run(() => api.admin.resetPassword(token, user.id, password)).then((ok) => {
          if (ok) onDone();
        });
      }}
      className="flex flex-wrap items-center gap-3"
    >
      <div className="flex items-center gap-1.5 text-xs text-slate-400 mr-1">
        <KeyRound className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
        <span>
          New password for <span className="text-slate-200 font-medium">{user.name}</span>
          <span className="text-slate-600"> — current password not needed</span>
        </span>
      </div>
      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        type="text"
        placeholder="New password (6+ chars)"
        autoFocus
        className={inputClass + " md:max-w-56"}
      />
      <button
        type="submit"
        disabled={!valid}
        className={
          btnPrimary + " disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-500"
        }
      >
        Reset password
      </button>
      <button
        type="button"
        onClick={onDone}
        className="text-xs text-slate-400 hover:text-slate-200"
      >
        Cancel
      </button>
    </form>
  );
}

// ---------------- AUDIT LOG ----------------
const ACCOUNT_EVENT_META = {
  create: {
    label: "Created",
    cls: "bg-emerald-500/10 text-emerald-300 border-emerald-900/50",
  },
  update: { label: "Updated", cls: "bg-emerald-500/10 text-emerald-300 border-emerald-800/50" },
  delete: { label: "Deleted", cls: "bg-red-500/10 text-red-300 border-red-900/50" },
  reset_password: {
    label: "Password reset",
    cls: "bg-blue-500/10 text-blue-300 border-blue-900/50",
  },
};

const EVENT_FIELD_LABELS = {
  name: "Name",
  email: "Email",
  role: "Role",
  fleetDriver: "Fleet driver",
  password: "Password",
};

function AuditTab({ events }) {
  if (!events) return null;
  return (
    <div>
      <p className="text-xs text-slate-500 mb-4">
        Every admin change to a user account — who changed what, and when. Password
        entries only show that a reset happened; the value itself is never recorded.
        Deleted-account entries keep the name and email they had at the time.
      </p>
      {events.length === 0 ? (
        <p className="text-slate-500 text-sm border border-dashed border-slate-800 rounded-lg p-6 text-center">
          No account changes recorded yet — create, edit, or delete a user to see it here.
        </p>
      ) : (
        <div className="space-y-2">
          {events.map((e) => {
            const meta = ACCOUNT_EVENT_META[e.action] || ACCOUNT_EVENT_META.update;
            const verb =
              e.action === "delete"
                ? "deleted the account of"
                : e.action === "reset_password"
                ? "reset the password for"
                : e.action === "create"
                ? "created an account for"
                : "updated the account of";
            return (
              <div
                key={e.id}
                className="bg-slate-900 border border-slate-800 rounded-lg p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm min-w-0">
                    <span
                      className={
                        "text-[10px] font-medium uppercase tracking-wide border rounded px-1.5 py-0.5 " +
                        meta.cls
                      }
                    >
                      {meta.label}
                    </span>
                    <span className="text-slate-200 font-medium">{e.actorName}</span>
                    <span className="text-slate-500">{verb}</span>
                    <span className="text-slate-200">{e.targetName}</span>
                    <span className="text-[11px] text-slate-600 truncate">
                      ({e.targetEmail})
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-600 shrink-0">
                    {new Date(e.createdAt).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                {e.changes.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    {e.changes.map((c, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded bg-slate-950 border border-slate-800 px-2 py-1 text-[11px] text-slate-400"
                      >
                        <span className="text-slate-500">
                          {EVENT_FIELD_LABELS[c.field] || c.field}:
                        </span>
                        {c.field === "password" ? (
                          <span className="text-slate-200">set to a new value</span>
                        ) : (
                          <>
                            {c.before != null && (
                              <span className="text-slate-300 line-through decoration-slate-600">
                                {c.before === "" ? "—" : c.before}
                              </span>
                            )}
                            {c.before != null && c.after != null && (
                              <span className="text-slate-600">→</span>
                            )}
                            {c.after != null && (
                              <span className="text-slate-200">
                                {c.after === "" ? "—" : c.after}
                              </span>
                            )}
                          </>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------- PAYOUTS ----------------
// Drivers earn a configurable percentage of each order's delivery fee (the
// rate is snapshotted per order when it is priced/completed, so changing the
// rate here never rewrites past earnings). This tab shows what each driver is
// owed over the selected period and records payouts — the full outstanding
// balance or a manually entered partial amount.
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

function PayoutsTab({ token, drivers }) {
  const [feePct, setFeePct] = useState(null);
  const [feeDraft, setFeeDraft] = useState("");
  const [driverId, setDriverId] = useState("");
  const [range, setRange] = useState({ from: "", to: "" });
  const [report, setReport] = useState(null);
  const [payouts, setPayouts] = useState([]);
  const [payoutMode, setPayoutMode] = useState("full");
  const [partialAmount, setPartialAmount] = useState("");
  const [payoutNote, setPayoutNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showEarnings, setShowEarnings] = useState(true);
  const [summary, setSummary] = useState([]);
  const [driverMessage, setDriverMessage] = useState("");

  async function load() {
    try {
      const [settings, rep, pays, sum] = await Promise.all([
        api.admin.payoutSettings(token),
        api.admin.driverEarnings(token, {
          driverId: driverId || undefined,
          from: range.from || undefined,
          to: range.to || undefined,
        }),
        api.admin.payouts(token, driverId || undefined),
        api.admin.driversSummary(token, {
          from: range.from || undefined,
          to: range.to || undefined,
        }),
      ]);
      setFeePct(settings.feePct);
      setFeeDraft(String(settings.feePct));
      setShowEarnings(settings.showDriverEarnings !== false);
      setReport(rep);
      setPayouts(pays);
      setSummary(sum);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, driverId, range.from, range.to]);

  // Paid amounts are only split per driver when a single driver is selected.
  const selectedTotal = report?.totals ?? { earned: 0, paid: 0, outstanding: 0, orderCount: 0 };

  async function run(fn) {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveFeePct() {
    const value = Number(feeDraft);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      setError("Fee percentage must be between 0 and 100");
      return;
    }
    await run(() => api.admin.setFeePct(token, value));
  }

  async function recordPayout(targetDriverId) {
    if (payoutMode === "partial") {
      const value = Number(partialAmount);
      if (!Number.isFinite(value) || value <= 0) {
        setError("Enter a positive payout amount");
        return;
      }
    }
    await run(() =>
      api.admin.recordPayout(token, {
        driverId: targetDriverId,
        mode: payoutMode,
        amount: payoutMode === "partial" ? Number(partialAmount) : undefined,
        note: payoutNote.trim(),
        driverMessage: driverMessage.trim() || undefined,
      })
    );
    setPartialAmount("");
    setPayoutNote("");
    setDriverMessage("");
  }

  const rangeActive = range.from || range.to;
  const payoutDisabled = payoutMode === "partial" && !(Number(partialAmount) > 0);
  // driverId → their CURRENT effective rate, for the detail-table chips. A
  // row's rate is the snapshot taken when the order was priced, so a chip is
  // flagged "locked" when the row's snapshot differs from today's rate.
  const effectiveByDriver = new Map(summary.map((s) => [s.driverId, s.feePct]));

  async function exportCsv() {
    setError("");
    try {
      const blob = await api.admin.earningsCsv(token, {
        driverId: driverId || undefined,
        from: range.from || undefined,
        to: range.to || undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dlvrd-earnings-${driverId || "all-drivers"}-${
        new Date().toISOString().slice(0, 10)
      }.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      {/* Rate setting + driver-earnings visibility */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6 flex flex-wrap items-end gap-4">
        <div className="min-w-[240px]">
          <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
            Driver fee percentage
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              className={inputClass + " max-w-[110px]"}
              value={feeDraft}
              onChange={(e) => setFeeDraft(e.target.value)}
            />
            <span className="text-sm text-slate-400">%</span>
            <button
              className={btnPrimary + " px-4"}
              disabled={busy || Number(feeDraft) === feePct}
              onClick={saveFeePct}
            >
              Save
            </button>
          </div>
          <p className="text-[11px] text-slate-600 mt-2">
            Applied to orders when they are priced. Existing orders keep their
            original rate.
          </p>
        </div>
        <div className="min-w-[240px]">
          <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
            Driver earnings card
          </label>
          <button
            className={
              "px-4 py-2 rounded-md text-sm font-medium transition-colors " +
              (showEarnings
                ? "bg-emerald-400/90 text-slate-950 hover:bg-emerald-300"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700")
            }
            disabled={busy}
            onClick={async () => {
              const next = !showEarnings;
              setShowEarnings(next); // optimistic
              try {
                await api.admin.setShowDriverEarnings(token, next);
                await load();
              } catch (e) {
                setShowEarnings(!next);
                setError(e.message);
              }
            }}
          >
            {showEarnings ? "Visible to drivers" : "Hidden from drivers"}
          </button>
          <p className="text-[11px] text-slate-600 mt-2">
            When hidden, drivers don't see the "My earnings" card in their
            console. Admin reporting is unaffected.
          </p>
        </div>
      </div>

      {/* Report controls */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
            Driver
          </label>
          <select
            className={inputClass + " min-w-[180px]"}
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
          >
            <option value="">All drivers</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
            Completed from
          </label>
          <input
            type="date"
            className={inputClass}
            value={range.from}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
            Completed to
          </label>
          <input
            type="date"
            className={inputClass}
            value={range.to}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
          />
        </div>
        {rangeActive && (
          <button
            className={btnGhost + " px-4"}
            onClick={() => setRange({ from: "", to: "" })}
          >
            Clear range
          </button>
        )}
        <button
          className={btnGhost + " px-4 flex items-center gap-1.5"}
          onClick={exportCsv}
          disabled={busy}
          title="Download the current report as CSV"
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      {/* Totals + payout action */}
      <div className="flex flex-wrap gap-4 mb-6">
        <StatBlock label="Orders" value={selectedTotal.orderCount} />
        <StatBlock label="Earned" value={money(selectedTotal.earned)} />
        <StatBlock label="Paid out" value={money(selectedTotal.paid)} />
        <StatBlock
          label="Outstanding"
          value={money(selectedTotal.outstanding)}
        />
      </div>

      {error && (
        <div className="mb-6 border border-red-900 bg-red-950/40 text-red-300 rounded-md px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {/* Payout form (per driver when "All drivers" is selected) */}
      {!driverId && summary.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2" style={fontHead}>
            <Wallet className="h-4 w-4 text-emerald-400" /> Balance by driver
          </h3>
          <div className="space-y-2">
            {summary.map((g) => (
              <div
                key={g.driverId}
                className="flex flex-wrap items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm"
              >
                <span className="text-slate-200">
                  {g.driverName}
                  <span className="text-slate-600 ml-2">
                    {g.orderCount} order{g.orderCount === 1 ? "" : "s"}
                  </span>
                  <span
                    className={
                      "ml-2 text-[10px] uppercase tracking-wide border rounded px-1.5 py-0.5 " +
                      (g.hasOverride
                        ? "border-amber-800 text-amber-400"
                        : "border-slate-700 text-slate-500")
                    }
                    title={
                      g.hasOverride
                        ? "Per-driver override (set on the driver's edit row)"
                        : "Uses the global fee percentage"
                    }
                  >
                    {g.feePct}%{g.hasOverride ? " override" : ""}
                  </span>
                </span>
                <span className="text-slate-300">
                  {money(g.earned)} earned
                  <span className="text-slate-600 ml-2">
                    {money(g.outstanding)} owed
                  </span>
                </span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-600 mt-3">
            Select a specific driver above to record a payout for them.
          </p>
        </div>
      )}

      {driverId && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2" style={fontHead}>
            <Wallet className="h-4 w-4 text-emerald-400" /> Record a payout
          </h3>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
                Type
              </label>
              <select
                className={inputClass + " min-w-[140px]"}
                value={payoutMode}
                onChange={(e) => setPayoutMode(e.target.value)}
              >
                <option value="full">Full outstanding</option>
                <option value="partial">Partial (manual amount)</option>
              </select>
            </div>
            {payoutMode === "partial" && (
              <div>
                <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
                  Amount
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  className={inputClass + " max-w-[140px]"}
                  value={partialAmount}
                  onChange={(e) => setPartialAmount(e.target.value)}
                />
              </div>
            )}
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
                Internal note (optional)
              </label>
              <input
                type="text"
                placeholder="e.g. weekly settlement — not shown to the driver"
                className={inputClass}
                value={payoutNote}
                onChange={(e) => setPayoutNote(e.target.value)}
              />
            </div>
            <button
              className={btnPrimary + " px-5"}
              disabled={busy || payoutDisabled}
              onClick={() => recordPayout(driverId)}
            >
              Record payout
            </button>
          </div>
          <div className="mt-3">
            <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
              Message to driver (optional — what they see in their app)
            </label>
            <input
              type="text"
              placeholder="Leave empty for: You've been paid $X.XX"
              className={inputClass}
              value={driverMessage}
              onChange={(e) => setDriverMessage(e.target.value)}
            />
          </div>
          {payoutMode === "full" && (
            <p className="text-[11px] text-slate-600 mt-2">
              Settles the driver's entire all-time outstanding balance
              (currently {money(selectedTotal.outstanding)}).
            </p>
          )}
        </div>
      )}

      {/* Per-order earnings */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
        <h3 className="text-sm font-medium text-slate-300 mb-3" style={fontHead}>
          Earnings detail
        </h3>
        {report?.orders?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-600">
                  <th className="py-2 pr-3">Order</th>
                  {!driverId && <th className="py-2 pr-3">Driver</th>}
                  <th className="py-2 pr-3">Customer</th>
                  <th className="py-2 pr-3">Completed</th>
                  <th className="py-2 pr-3 text-right">Fee</th>
                  <th className="py-2 pr-3 text-right">Rate</th>
                  <th className="py-2 text-right">Earned</th>
                </tr>
              </thead>
              <tbody>
                {report.orders.map((o) => (
                  <tr key={o.orderId} className="border-t border-slate-800/60">
                    <td className="py-2 pr-3 font-mono text-xs text-slate-400">{o.orderId}</td>
                    {!driverId && <td className="py-2 pr-3 text-slate-300">{o.driverName}</td>}
                    <td className="py-2 pr-3 text-slate-300">{o.customerName}</td>
                    <td className="py-2 pr-3 text-slate-500 text-xs">
                      {new Date(o.completedAt).toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td className="py-2 pr-3 text-right text-slate-300">{money(o.cost)}</td>
                    <td className="py-2 pr-3 text-right">
                      {(() => {
                        const current = effectiveByDriver.get(o.driverId);
                        const locked = current != null && current !== o.feePct;
                        return (
                          <span
                            className={
                              "inline-block text-[10px] uppercase tracking-wide border rounded px-1.5 py-0.5 " +
                              (locked
                                ? "border-amber-800 text-amber-400"
                                : "border-slate-700 text-slate-500")
                            }
                            title={
                              locked
                                ? `Rate locked when this order was priced — the driver's current rate is ${current}%`
                                : "Rate applied to this order"
                            }
                          >
                            {o.feePct}%{locked ? " locked" : ""}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="py-2 text-right text-slate-200">{money(o.earned)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            No completed orders in this period.
          </p>
        )}
      </div>

      {/* Payout history */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-slate-300 mb-3" style={fontHead}>
          Payout history
        </h3>
        {payouts.length ? (
          <div className="space-y-2">
            {payouts.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <span className="text-slate-200">{money(p.amount)}</span>
                  <span
                    className={
                      "ml-2 text-[10px] uppercase tracking-wide border rounded px-1.5 py-0.5 " +
                      (p.mode === "full"
                        ? "border-green-800 text-green-400"
                        : "border-amber-800 text-amber-400")
                    }
                  >
                    {p.mode}
                  </span>
                  {p.note && <span className="ml-2 text-slate-500">{p.note}</span>}
                  {p.actorName && (
                    <span className="ml-2 text-[11px] text-slate-600">by {p.actorName}</span>
                  )}
                </div>
                <span className="text-[11px] text-slate-600">
                  {new Date(p.paidAt).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No payouts recorded yet.</p>
        )}
      </div>
    </div>
  );
}
