import React, { useEffect, useState } from "react";
import { MapPin, LogOut, Shield, Wrench } from "lucide-react";
import { api, SESSION_KEY, DEV_EMAIL, DEV_PASSWORD } from "./api.js";
import { fontBody, fontHead } from "./components.jsx";
import LoginView from "./views/LoginView.jsx";
import CustomerView from "./views/CustomerView.jsx";
import DispatcherView from "./views/DispatcherView.jsx";
import DriverView from "./views/DriverView.jsx";
import AdminView from "./views/AdminView.jsx";

const DEV_ROLES = ["customer", "dispatcher", "driver", "admin"];

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [session, setSession] = useState(readSession);
  const [orders, setOrders] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [adminView, setAdminView] = useState("admin"); // admin | dispatch
  const [actionError, setActionError] = useState("");
  const [switchingRole, setSwitchingRole] = useState(false);
  const prevLoadingRef = React.useRef(false);

  const token = session?.token || null;
  const user = session?.user || null;

  // Remove the static boot splash once React has mounted. Defend against the
  // edge case where the splash isn't in the live DOM (bfcache restore, SW nav
  // push, or an HTML build that omitted it) — otherwise removeChild throws and
  // destabilises the whole tree.
  useEffect(() => {
    const splash = document.getElementById("boot-splash");
    if (splash?.parentNode) {
      try { splash.remove(); } catch { /* already gone */ }
    }
  }, []);

  // Restart the brand-kit preloader animation whenever a new load begins (e.g.
  // after a role switch or a data-changing action). The initial load finishes
  // it via DLV.done() in the session-effect below.
  useEffect(() => {
    if (loading && !prevLoadingRef.current) {
      window.DLV?.restart?.();
    }
    prevLoadingRef.current = loading;
  }, [loading]);

  // Validate the stored session and load data on login/logout. When the
  // initial load completes we also tell the brand-kit preloader to finish
  // (100% / delivered + fade out) via the DLV global declared by Preloader.
  useEffect(() => {
    if (!token) {
      setOrders([]);
      setDrivers([]);
      // No session — instantly hide the preloader so the login page is visible.
      // Use hide() (not done()) to avoid a stale 650 ms setTimeout that would
      // collapse the overlay mid-animation on a subsequent login+data-load cycle.
      window.DLV?.hide?.();
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { user: me } = await api.me(token);
        if (cancelled) return;
        setSession((s) => (s ? { ...s, user: me } : s));
        const [o, d] = await Promise.all([
          api.getOrders(token),
          api.getDrivers(token),
        ]);
        if (cancelled) return;
        setOrders(o);
        setDrivers(d);
      } catch {
        if (!cancelled) logout();
      } finally {
        if (!cancelled) {
          setLoading(false);
          window.DLV?.done?.();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function login(data) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
    setSession(data);
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setActionError("");
  }

  // Dev convenience: swap role without logging out — re-runs the dev login as
  // the new role, which replaces the session and reloads data.
  async function switchDevRole(role) {
    if (switchingRole || role === user?.role) return;
    setSwitchingRole(true);
    setActionError("");
    try {
      login(await api.loginDev(DEV_EMAIL, DEV_PASSWORD, role));
    } catch (e) {
      setActionError(e.message || "Role switch failed");
    } finally {
      setSwitchingRole(false);
    }
  }

  async function refreshData() {
    if (!token) return;
    const [o, d] = await Promise.all([
      api.getOrders(token),
      api.getDrivers(token),
    ]);
    setOrders(o);
    setDrivers(d);
  }

  async function runAndRefresh(action) {
    setActionError("");
    try {
      await action();
      await refreshData();
    } catch (e) {
      setActionError(e.message || "Something went wrong");
      await refreshData().catch(() => {});
    }
  }

  const handlers = {
    placeOrder: (order) => runAndRefresh(() => api.createOrder(token, order)),
    cancelOrder: (id) => runAndRefresh(() => api.cancelOrder(token, id)),
    requestCancel: (id, reason) =>
      runAndRefresh(() => api.requestCancel(token, id, reason)),
    approveCancel: (id) => runAndRefresh(() => api.approveCancel(token, id)),
    reassignOrder: (id, driverId) =>
      runAndRefresh(() => api.reassignOrder(token, id, driverId)),
    payOrder: (id) => runAndRefresh(() => api.payOrder(token, id)),
    priceOrder: (id, cost) => runAndRefresh(() => api.priceOrder(token, id, cost)),
    assignOrder: (id, driverId) =>
      runAndRefresh(() => api.assignOrder(token, id, driverId)),
    unassignOrder: (id) => runAndRefresh(() => api.unassignOrder(token, id)),
    moveStop: (stopId, fromDriverId, toDriverId, toIndex) =>
      runAndRefresh(() =>
        api.moveStop(token, stopId, fromDriverId, toDriverId, toIndex)
      ),
    toggleStop: (stopId) => runAndRefresh(() => api.toggleStop(token, stopId)),
    setStopNotes: (stopId, notes) =>
      runAndRefresh(() => api.setStopNotes(token, stopId, notes)),
    setOrderNotes: (orderId, notes) =>
      runAndRefresh(() => api.setOrderNotes(token, orderId, notes)),
    setDriverNote: (stopId, notes) =>
      runAndRefresh(() => api.setDriverNote(token, stopId, notes)),
    enrouteStop: (stopId) => runAndRefresh(() => api.enrouteStop(token, stopId)),
    uploadPhoto: (stopId, file) =>
      runAndRefresh(() => api.uploadStopPhoto(token, stopId, file)),
    addOrder: (order) => runAndRefresh(() => api.createOrder(token, order)),
    addDriver: (driver) => runAndRefresh(() => api.addDriver(token, driver)),
    updateDriver: (id, patch) =>
      runAndRefresh(() => api.updateDriver(token, id, patch)),
    setAvailability: (id, available) =>
      runAndRefresh(() => api.setAvailability(token, id, available)),
  };

  // A malformed stored session (no user payload) is treated as logged out.
  if (!session || !user) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100" style={fontBody}>
        <LoginView onLogin={login} />
      </div>
    );
  }

  const unassignedOrders = orders.filter((o) => o.status === "unassigned");
  const fleetDriver =
    user.role === "driver"
      ? drivers.find((d) => d.id === (user.fleetDriverId ?? user.fleet_driver_id))
      : null;

  const dispatchBoard = (
    <DispatcherView
      token={token}
      orders={orders}
      unassignedOrders={unassignedOrders}
      drivers={drivers}
      onPrice={handlers.priceOrder}
      onAssign={handlers.assignOrder}
      onUnassign={handlers.unassignOrder}
      onMoveStop={handlers.moveStop}
      onToggleStop={handlers.toggleStop}
      onSetStopNotes={handlers.setStopNotes}
      onSaveOrderNotes={handlers.setOrderNotes}
      onRemoveDriverNote={handlers.setDriverNote}
      onAddDriver={handlers.addDriver}
      onAddOrder={handlers.addOrder}
      onCancelOrder={handlers.cancelOrder}
      onApproveCancel={handlers.approveCancel}
      onReassign={handlers.reassignOrder}
      onUpdateDriver={handlers.updateDriver}
      onSetAvailability={handlers.setAvailability}
      onRefreshData={refreshData}
    />
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" style={fontBody}>
      <header className="border-b border-slate-800 bg-slate-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md flex items-center justify-center" style={{ color: '#ffffff' }}>
              <svg width="32" height="32" viewBox="0 0 64 64" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 30h8M6 40h8" stroke="#12b76a" strokeWidth="4"/>
                <rect x="18" y="24" width="40" height="32" rx="7" stroke="#ffffff" strokeWidth="4"/>
                <path d="M24 24l6-8h18l6 8" stroke="#ffffff" strokeWidth="4"/>
                <path d="M34 46L46 34m0 0h-8m8 0v8" stroke="#12b76a" strokeWidth="4"/>
              </svg>
            </div>
            <div>
              <div className="text-lg font-semibold leading-none" style={fontHead}>
                Delive<span style={{ color: '#12b76a' }}>ree</span>
              </div>
              <div className="text-xs text-slate-500 leading-none mt-1">
                delivery dispatch
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {user.isDev && (
              <>
                <span
                  className="inline-flex items-center gap-1 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-full px-2.5 py-1"
                  title="Dev login — switch roles without logging out"
                >
                  <Wrench className="h-3 w-3" /> Dev mode
                </span>
                {/* Role switcher: re-runs the dev login as the picked role. */}
                <div
                  className="flex bg-slate-900 border border-slate-800 rounded-full p-1"
                  title="Switch dev role"
                >
                  {DEV_ROLES.map((r) => (
                    <button
                      key={r}
                      onClick={() => switchDevRole(r)}
                      disabled={switchingRole}
                      className={
                        "px-2.5 py-1 text-[11px] rounded-full capitalize transition-colors disabled:opacity-50 " +
                        (user.role === r
                          ? "bg-emerald-500 text-slate-950 font-medium"
                          : "text-slate-400 hover:text-slate-200")
                      }
                    >
                      {switchingRole && user.role !== r ? "…" : r}
                    </button>
                  ))}
                </div>
              </>
            )}
            {user.role === "admin" && (
              <div className="flex bg-slate-900 border border-slate-800 rounded-full p-1">
                <button
                  onClick={() => setAdminView("admin")}
                  className={
                    "px-3 py-1.5 text-sm rounded-full transition-colors flex items-center gap-1.5 " +
                    (adminView === "admin"
                      ? "bg-emerald-500 text-slate-950 font-medium"
                      : "text-slate-400 hover:text-slate-200")
                  }
                >
                  <Shield className="h-3.5 w-3.5" /> Admin panel
                </button>
                <button
                  onClick={() => setAdminView("dispatch")}
                  className={
                    "px-3 py-1.5 text-sm rounded-full transition-colors " +
                    (adminView === "dispatch"
                      ? "bg-emerald-500 text-slate-950 font-medium"
                      : "text-slate-400 hover:text-slate-200")
                  }
                >
                  Dispatch console
                </button>
              </div>
            )}

            <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-full pl-3 pr-1.5 py-1.5">
              <div className="text-right">
                <div className="text-xs font-medium leading-tight">{user.name}</div>
                <div className="text-[11px] text-slate-500 leading-tight capitalize">
                  {user.role}
                </div>
              </div>
              <button
                onClick={logout}
                title="Log out"
                className="h-8 w-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {actionError && (
          <div className="mb-4 flex items-start justify-between gap-3 bg-red-950/40 border border-red-900/60 rounded-lg px-4 py-3">
            <p className="text-sm text-red-300">{actionError}</p>
            <button
              onClick={() => setActionError("")}
              title="Dismiss"
              className="text-red-400 hover:text-red-200 text-sm leading-none"
            >
              ✕
            </button>
          </div>
        )}
        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="h-8 w-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
          </div>
        )}
        {!loading && (
          <>
            {user.role === "customer" && (
              <CustomerView
                currentUser={user}
                orders={orders}
                drivers={drivers}
                placeOrder={handlers.placeOrder}
                cancelOrder={handlers.cancelOrder}
                payOrder={handlers.payOrder}
              />
            )}
            {user.role === "dispatcher" && dispatchBoard}
            {user.role === "driver" && (
              <DriverView
                driver={fleetDriver}
                orders={orders}
                token={token}
                onToggleStop={handlers.toggleStop}
                onEnRoute={handlers.enrouteStop}
                onUploadPhoto={handlers.uploadPhoto}
                onUpdateVehicle={(patch) =>
                  fleetDriver && handlers.updateDriver(fleetDriver.id, patch)
                }
                onSetAvailability={(available) =>
                  fleetDriver && handlers.setAvailability(fleetDriver.id, available)
                }
                onRequestCancel={handlers.requestCancel}
                onDriverNote={handlers.setDriverNote}
              />
            )}
            {user.role === "admin" &&
              (adminView === "admin" ? (
                <AdminView
                  token={token}
                  orders={orders}
                  drivers={drivers}
                  onDataChanged={refreshData}
                />
              ) : (
                dispatchBoard
              ))}
          </>
        )}
      </main>
    </div>
  );
}