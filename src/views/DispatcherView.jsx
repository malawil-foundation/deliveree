import React, { useState, useEffect, useRef } from "react";
import {
  Package,
  MapPin,
  Truck,
  CheckCircle2,
  Circle,
  GripVertical,
  Plus,
  ClipboardList,
  X,
  DollarSign,
  Bell,
  AlertTriangle,
  Pencil,
  Navigation,
  Camera,
  CameraOff,
  StickyNote,
  MessageSquare,
  ScrollText,
} from "lucide-react";
import {
  fontHead,
  fontMono,
  StatusBadge,
  StatBlock,
  inputClass,
  formatLoc,
  Lightbox,
  Modal,
  fmtTime,
  PARISHES,
} from "../components.jsx";
import { api } from "../api.js";

const fmtClock = fmtTime;

// Badge styling + field labels for the driver-account change log (the admin audit
// tab mirrors this vocabulary, minus the dispatcher-only role filter).
const ACCT_EVENT_META = {
  create: {
    label: "Created",
    cls: "text-emerald-300 border-emerald-900/60 bg-emerald-500/10",
  },
  update: { label: "Updated", cls: "text-emerald-300 border-emerald-800/60 bg-emerald-500/10" },
  delete: { label: "Deleted", cls: "text-red-300 border-red-900/60 bg-red-500/10" },
  reset_password: {
    label: "Password reset",
    cls: "text-blue-300 border-blue-900/60 bg-blue-500/10",
  },
};

const ACCT_FIELD_LABELS = {
  name: "Name",
  email: "Email",
  role: "Role",
  fleetDriver: "Fleet driver",
  password: "Password",
};

// Small helper: renders a clickable map-pin icon that opens Google Maps at the
// given lat/lng in a new tab. Returns null when either coord is missing.
function MapLink({ lat, lng, label = "Map" }) {
  if (lat == null || lng == null) return null;
  return (
    <a
      href={`https://maps.google.com/?q=${lat},${lng}`}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${label} in Google Maps (${lat}, ${lng})`}
      className="inline-flex items-center gap-0.5 text-[10px] text-emerald-400 hover:text-emerald-300 transition-colors"
      onClick={(e) => e.stopPropagation()}
    >
      <MapPin className="h-2.5 w-2.5" />
      map
    </a>
  );
}

export default function DispatcherView({
  token,
  orders,
  unassignedOrders,
  drivers,
  onPrice,
  onAssign,
  onUnassign,
  onMoveStop,
  onToggleStop,
  onSetStopNotes,
  onSaveOrderNotes,
  onRemoveDriverNote,
  onAddDriver,
  onAddOrder,
  onCancelOrder,
  onApproveCancel,
  onReassign,
  onUpdateDriver,
  onSetAvailability,
  onRefreshData,
}) {
  const [showAddDriver, setShowAddDriver] = useState(false);
  const [showAddOrder, setShowAddOrder] = useState(false);
  const [tab, setTab] = useState("board"); // board | orders | fleet
  const [dragOverTarget, setDragOverTarget] = useState(null);
  const [editingDriverId, setEditingDriverId] = useState(null);
  const [notes, setNotes] = useState({ items: [], unread: 0 });
  const [showNotes, setShowNotes] = useState(false);
  const [showAccountLog, setShowAccountLog] = useState(false);
  const [accountLog, setAccountLog] = useState(null);
  const [photoLightbox, setPhotoLightbox] = useState(null);
  const lastUnread = useRef(0);

  const activeDrivers = drivers.filter((d) => d.stops.length > 0).length;
  const pendingStops = drivers
    .flatMap((d) => d.stops)
    .filter((s) => !s.done).length;
  const needsPricing = orders.filter((o) => o.status === "pending_review");
  const flagged = orders.filter((o) =>
    ["assigned", "cancel_requested"].includes(o.status)
  );

  // Poll the dispatcher notification feed; refresh the board when new
  // driver activity (on my way / cancellation request) shows up.
  useEffect(() => {
    if (!token) return;
    let alive = true;
    async function poll() {
      try {
        const n = await api.getNotifications(token);
        if (!alive) return;
        setNotes(n);
        if (n.unread > lastUnread.current) {
          lastUnread.current = n.unread;
          onRefreshData?.();
        }
      } catch {
        /* transient poll errors are fine */
      }
    }
    poll();
    const timer = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function getDragData(e) {
    try {
      return JSON.parse(e.dataTransfer.getData("application/json"));
    } catch {
      return null;
    }
  }

  async function performDrop(targetDriverId, targetIndex, dragData) {
    if (!dragData) return;
    if (dragData.kind === "order") {
      await onAssign(dragData.orderId, targetDriverId);
      return;
    }
    if (dragData.kind === "stop") {
      await onMoveStop(
        dragData.stopId,
        dragData.sourceDriverId,
        targetDriverId,
        targetIndex
      );
    }
  }

  async function markNotesRead() {
    try {
      await api.markNotificationsRead(token);
      setNotes((n) => ({ items: n.items, unread: 0 }));
      lastUnread.current = 0;
    } catch {
      /* ignore */
    }
  }

  async function loadAccountLog() {
    try {
      setAccountLog(await api.driverAccountEvents(token));
    } catch {
      setAccountLog([]);
    }
  }

  async function fetchNoteHistory({ stopId, orderId } = {}) {
    try {
      return await api.noteHistory(token, { stopId, orderId });
    } catch {
      return [];
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <h1 className="text-lg font-semibold flex items-center gap-2" style={fontHead}>
          Dispatch console
        </h1>

        <div className="flex items-center gap-2">
          {/* Primary actions — always one click away in the header */}
          <button
            onClick={() => setShowAddOrder(true)}
            className="flex items-center gap-1.5 text-xs bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-medium rounded-md px-3 py-2 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Add order
          </button>
          <button
            onClick={() => setShowAddDriver(true)}
            className="flex items-center gap-1.5 text-xs border border-slate-700 hover:border-slate-600 rounded-md px-3 py-2 text-slate-300 hover:text-slate-100 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Add driver
          </button>

          {/* driver-account change log */}
          <div className="relative">
            <button
              onClick={() => {
                setShowAccountLog((v) => !v);
                if (!showAccountLog) loadAccountLog();
              }}
              className="relative h-9 w-9 rounded-full border border-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition-colors"
              title="Driver-account changes (created by admins)"
            >
              <ScrollText className="h-4 w-4" />
            </button>

            {showAccountLog && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowAccountLog(false)}
                />
                <div className="absolute right-0 top-full mt-2 w-[26rem] max-w-[90vw] z-20 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800">
                    <span className="text-xs font-semibold text-slate-300">
                      Driver-account changes
                    </span>
                    <button
                      onClick={loadAccountLog}
                      className="text-[11px] text-emerald-400 hover:text-emerald-300"
                    >
                      Refresh
                    </button>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {accountLog === null ? (
                      <p className="text-xs text-slate-600 text-center p-6">
                        Loading…
                      </p>
                    ) : accountLog.length === 0 ? (
                      <p className="text-xs text-slate-600 text-center p-6">
                        No driver-account changes yet. Admin-created driver logins,
                        edits, password resets, and fleet-driver links will appear here.
                      </p>
                    ) : (
                      accountLog.map((e) => {
                        const meta = ACCT_EVENT_META[e.action] || ACCT_EVENT_META.update;
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
                            className="px-4 py-3 border-b border-slate-800/60 last:border-0"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-xs text-slate-200 leading-snug min-w-0">
                                <span
                                  className={
                                    "inline-block align-middle text-[9px] font-semibold uppercase tracking-wide border rounded px-1 py-px mr-1.5 " +
                                    meta.cls
                                  }
                                >
                                  {meta.label}
                                </span>
                                <span className="text-slate-400">{e.actorName}</span>{" "}
                                <span className="text-slate-600">{verb}</span>{" "}
                                <span className="font-medium">{e.targetName}</span>
                              </p>
                              <span className="text-[10px] text-slate-600 shrink-0">
                                {fmtClock(e.createdAt)}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-600 mt-0.5">
                              {e.targetEmail}
                            </p>
                            {e.changes.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {e.changes.map((c, i) => (
                                  <span
                                    key={i}
                                    className="text-[10px] text-slate-400 bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 inline-flex items-center gap-1"
                                  >
                                    <span className="text-slate-600">
                                      {ACCT_FIELD_LABELS[c.field] || c.field}:
                                    </span>
                                    {c.field === "password" ? (
                                      <span className="text-slate-300">
                                        set to a new value
                                      </span>
                                    ) : (
                                      <>
                                        {c.before != null && (
                                          <span className="text-slate-400 line-through decoration-slate-600">
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
                      })
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* notifications bell */}
          <div className="relative">
          <button
            onClick={() => {
              setShowNotes((v) => !v);
              if (!showNotes && notes.unread > 0) markNotesRead();
            }}
            className="relative h-9 w-9 rounded-full border border-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition-colors"
            title="Driver updates"
          >
            <Bell className="h-4 w-4" />
            {notes.unread > 0 && (
              <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-red-500 text-[10px] text-white font-semibold flex items-center justify-center">
                {notes.unread}
              </span>
            )}
          </button>

          {showNotes && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowNotes(false)}
              />
              <div className="absolute right-0 top-full mt-2 w-[480px] z-20 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
                  <div>
                    <span className="text-sm font-semibold text-slate-200">
                      Driver updates
                    </span>
                    {notes.items.length > 0 && (
                      <span className="ml-2 text-[11px] text-slate-500">
                        {notes.items.length} total
                        {notes.unread > 0 ? `, ${notes.unread} unread` : ""}
                      </span>
                    )}
                  </div>
                  {notes.unread > 0 && (
                    <button
                      onClick={markNotesRead}
                      className="text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-800/60 rounded px-2 py-0.5 transition-colors hover:bg-emerald-500/10"
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-[480px] overflow-y-auto divide-y divide-slate-800/60">
                  {notes.items.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 p-8 text-center">
                      <Bell className="h-8 w-8 text-slate-700" />
                      <p className="text-xs text-slate-600">
                        No driver updates yet. They'll appear here when a driver
                        heads to a stop, leaves a note, or asks to cancel.
                      </p>
                    </div>
                  ) : (
                    notes.items.map((n) => {
                      const NOTIF_CONFIG = {
                        "cancel-request": {
                          label: "Cancel request",
                          icon: AlertTriangle,
                          accent: "border-l-2 border-orange-500 bg-orange-500/5",
                          cls: "text-orange-400 bg-orange-500/10 border-orange-700/50",
                        },
                        "driver-note": {
                          label: "Driver note",
                          icon: MessageSquare,
                          accent: "border-l-2 border-sky-500 bg-sky-500/5",
                          cls: "text-sky-400 bg-sky-500/10 border-sky-700/50",
                        },
                        "on-my-way": {
                          label: "On the way",
                          icon: Navigation,
                          accent: "border-l-2 border-emerald-500 bg-emerald-500/5",
                          cls: "text-emerald-400 bg-emerald-500/10 border-emerald-700/50",
                        },
                        completed: {
                          label: "Completed",
                          icon: CheckCircle2,
                          accent: "border-l-2 border-emerald-500 bg-emerald-500/5",
                          cls: "text-emerald-400 bg-emerald-500/10 border-emerald-700/50",
                        },
                        "order-completed": {
                          label: "Order completed",
                          icon: CheckCircle2,
                          accent: "border-l-2 border-emerald-500 bg-emerald-500/5",
                          cls: "text-emerald-400 bg-emerald-500/10 border-emerald-700/50",
                        },
                        "on-duty": {
                          label: "On duty",
                          icon: Truck,
                          accent: "border-l-2 border-emerald-500 bg-emerald-500/5",
                          cls: "text-emerald-400 bg-emerald-500/10 border-emerald-700/50",
                        },
                        "off-duty": {
                          label: "Off duty",
                          icon: Truck,
                          accent: "border-l-2 border-slate-600 bg-slate-800/10",
                          cls: "text-slate-400 bg-slate-800/40 border-slate-700/50",
                        },
                        "photo-upload": {
                          label: "Photo upload",
                          icon: Camera,
                          accent: "border-l-2 border-blue-500 bg-blue-500/5",
                          cls: "text-blue-400 bg-blue-500/10 border-blue-700/50",
                        },
                        "driver-added": {
                          label: "Driver added",
                          icon: Truck,
                          accent: "border-l-2 border-emerald-500 bg-emerald-500/5",
                          cls: "text-emerald-400 bg-emerald-500/10 border-emerald-700/50",
                        },
                      };
                      const conf = NOTIF_CONFIG[n.kind] || {
                        label: n.kind,
                        icon: Navigation,
                        accent: "border-l-2 border-slate-700 bg-slate-800/5",
                        cls: "text-slate-400 bg-slate-800/40 border-slate-700/50",
                      };
                      const IconComponent = conf.icon;
                      return (
                        <div
                          key={n.id}
                          className={
                            "px-4 py-3 flex items-start gap-3 " +
                            (n.read ? "opacity-50" : conf.accent)
                          }
                        >
                          <IconComponent className="h-4 w-4 shrink-0 mt-0.5 text-slate-300" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={"text-[10px] font-medium px-1.5 py-0.5 rounded border " + conf.cls}>
                                {conf.label}
                              </span>
                              {n.orderId && (
                                <span className="text-[10px] text-slate-500" style={fontMono}>
                                  {n.orderId}
                                </span>
                              )}
                              <span className="text-[10px] text-slate-400 ml-auto font-mono">
                                {fmtClock(n.createdAt)}
                              </span>
                            </div>
                            <p className="text-xs text-slate-200 leading-snug">
                              {n.message}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}
          </div>
        </div>
      </div>

      {/* Stat blocks + tab bar — the primary navigation for the console */}
      <div className="flex flex-wrap gap-4 mb-4">
        <StatBlock label="Needs pricing" value={needsPricing.length} />
        <StatBlock label="Unassigned orders" value={unassignedOrders.length} />
        <StatBlock label="Drivers with active jobs" value={activeDrivers} />
        <StatBlock label="Stops pending" value={pendingStops} />
      </div>

      <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 mb-5 w-fit max-w-full overflow-x-auto">
        {[
          { id: "board", label: "Live board" },
          { id: "orders", label: `Orders (${flagged.length + unassignedOrders.length})` },
          { id: "fleet", label: `Fleet (${drivers.length})` },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              "px-4 py-1.5 text-sm rounded-md transition-colors whitespace-nowrap " +
              (tab === t.id
                ? "bg-emerald-500 text-slate-950 font-medium"
                : "text-slate-400 hover:text-slate-200")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Live board tab: active jobs + pricing/pool + driver columns */}
      {tab === "board" && (
      <>
      {/* Active + flagged jobs (dispatcher can cancel at any time) */}
      {flagged.length > 0 && (
        <div className="mb-6 space-y-2">
          <h2
            className="text-sm font-semibold text-slate-300 flex items-center gap-1.5"
            style={fontHead}
          >
            <ClipboardList className="h-4 w-4" /> Active jobs
          </h2>
          <div className="grid md:grid-cols-2 gap-2">
            {flagged.map((o) => {
              const driver = drivers.find((d) => d.id === o.driverId);
              return (
                <div
                  key={o.id}
                  className={
                    "bg-slate-900 border rounded-lg p-3 " +
                    (o.status === "cancel_requested"
                      ? "border-orange-900/70"
                      : "border-slate-800")
                  }
                >
                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
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
                    <span className="ml-auto">
                      {driver ? (
                        <span className="flex items-center gap-1">
                          <Truck className="h-3.5 w-3.5" /> {driver.name}
                        </span>
                      ) : (
                        "Unassigned"
                      )}
                    </span>
                  </div>

                  {o.status === "cancel_requested" && (
                    <div className="flex items-center gap-1.5 text-[11px] text-orange-300 bg-orange-950/40 border border-orange-900/50 rounded px-2 py-1 mb-2">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      The driver asked to cancel this job. Approve it or
                      reassign it.
                    </div>
                  )}

                  <div className="space-y-0.5 text-xs mb-2">
                    <div className="flex items-start gap-1.5">
                      <Package className="h-3 w-3 text-blue-400 mt-0.5 shrink-0" />
                      <span className="text-slate-300">
                        {formatLoc(o.pickupAddress, o.pickupParish)}
                      </span>
                      <MapLink lat={o.pickupLat} lng={o.pickupLng} label="pickup" />
                    </div>
                    <div className="flex items-start gap-1.5">
                      <MapPin className="h-3 w-3 text-emerald-400 mt-0.5 shrink-0" />
                      <span className="text-slate-300">
                        {formatLoc(o.dropoffAddress, o.dropoffParish)}
                      </span>
                      <MapLink lat={o.dropoffLat} lng={o.dropoffLng} label="drop-off" />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge status={o.status} />
                    {o.status === "cancel_requested" && (
                      <>
                        <button
                          onClick={() => {
                            if (
                              window.confirm(
                                `Approve the cancellation of ${o.id}?`
                              )
                            )
                              onApproveCancel(o.id);
                          }}
                          className="text-[11px] bg-red-500/10 border border-red-900/60 text-red-300 hover:bg-red-500/20 rounded px-2 py-1 transition-colors"
                        >
                          Approve cancel
                        </button>
                        <ReassignInline
                          order={o}
                          drivers={drivers}
                          onReassign={onReassign}
                        />
                      </>
                    )}
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            `Cancel ${o.id}? The driver's route for it will be cleared.`
                          )
                        )
                          onCancelOrder(o.id);
                      }}
                      className="ml-auto text-[11px] text-red-400 hover:text-red-300"
                    >
                      Cancel job
                    </button>
                  </div>
                  {o.paying && o.payAmount != null && (
                    <div className="mt-2 text-xs">
                      <span className="text-slate-400">Paying </span>
                      <span className="font-medium text-slate-200">${o.payAmount.toFixed(2)}</span>
                    </div>
                  )}
                  {o.collecting && o.collectAmount != null && (
                    <div className="mt-1 text-xs">
                      <span className="text-slate-400">Collecting cash </span>
                      <span className="font-medium text-slate-200">${o.collectAmount.toFixed(2)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-4 gap-5">
        {/* Pricing + unassigned pool */}
        <div className="lg:col-span-1">
          <h2
            className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-1.5"
            style={fontHead}
          >
            <DollarSign className="h-4 w-4" /> Needs pricing
          </h2>
          <div className="space-y-2 mb-6">
            {needsPricing.length === 0 ? (
              <p className="text-xs text-slate-600 border border-dashed border-slate-800 rounded-lg text-center p-4">
                No new requests waiting on a price.
              </p>
            ) : (
              needsPricing.map((o) => (
                <PricingCard
                  key={o.id}
                  order={o}
                  onPrice={onPrice}
                  onSaveNotes={onSaveOrderNotes}
                  onFetchOrderHistory={fetchNoteHistory}
                />
              ))
            )}
          </div>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const data = getDragData(e);
              if (data?.kind === "stop" || data?.kind === "order") {
                onUnassign(data.orderId);
              }
            }}
          >
            <h2
              className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-1.5"
              style={fontHead}
            >
              <ClipboardList className="h-4 w-4" /> Unassigned orders
            </h2>
            <div className="space-y-2 bg-slate-900/60 border border-dashed border-slate-800 rounded-lg p-2 min-h-[140px]">
              {unassignedOrders.length === 0 ? (
                <p className="text-xs text-slate-600 text-center p-4">
                  Nothing waiting. Drop a stop here to unassign an order.
                </p>
              ) : (
                unassignedOrders.map((o) => (
                  <UnassignedCard
                    key={o.id}
                    order={o}
                    onCancel={onCancelOrder}
                    onSaveNotes={onSaveOrderNotes}
                    onFetchOrderHistory={fetchNoteHistory}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* Driver columns */}
        <div className="lg:col-span-3">
          <div className="flex gap-4 overflow-x-auto pb-2">
            {drivers.map((driver) => (
              <DriverColumn
                key={driver.id}
                driver={driver}
                performDrop={performDrop}
                onToggleStop={onToggleStop}
                onOpenPhoto={setPhotoLightbox}
                onSaveNote={onSetStopNotes}
                onRemoveDriverNote={onRemoveDriverNote}
                onFetchHistory={fetchNoteHistory}
                dragOverTarget={dragOverTarget}
                setDragOverTarget={setDragOverTarget}
                getDragData={getDragData}
                editing={editingDriverId === driver.id}
                onEdit={() =>
                  setEditingDriverId((id) => (id === driver.id ? null : driver.id))
                }
                onUpdateDriver={onUpdateDriver}
                onSetAvailability={onSetAvailability}
              />
            ))}
          </div>
        </div>
      </div>
      </>
      )}

      {/* Orders tab: all non-completed work in one list */}
      {tab === "orders" && (
        <div className="space-y-2">
          {needsPricing.length === 0 &&
          unassignedOrders.length === 0 &&
          flagged.length === 0 ? (
            <p className="text-xs text-slate-600 border border-dashed border-slate-800 rounded-lg text-center p-6">
              No open orders right now.
            </p>
          ) : (
            <div className="grid md:grid-cols-2 gap-2">
              {[
                ...needsPricing.map((o) => ({ order: o, where: "Needs pricing" })),
                ...unassignedOrders.map((o) => ({ order: o, where: "Unassigned" })),
                ...flagged.map((o) => ({ order: o, where: "Active job" })),
              ].map(({ order: o, where }) => {
                const driver = drivers.find((d) => d.id === o.driverId);
                return (
                  <div
                    key={o.id + where}
                    className="bg-slate-900 border border-slate-800 rounded-lg p-3"
                  >
                    <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                      <span style={fontMono}>{o.id}</span>
                      <span>&middot;</span>
                      <span>{o.customerName}</span>
                      <span className="ml-auto">
                        <StatusBadge status={o.status} />
                      </span>
                    </div>
                    <div className="space-y-0.5 text-xs mb-2">
                      <div className="flex items-start gap-1.5">
                        <Package className="h-3 w-3 text-blue-400 mt-0.5 shrink-0" />
                        <span className="text-slate-300">
                          {formatLoc(o.pickupAddress, o.pickupParish)}
                        </span>
                        <MapLink lat={o.pickupLat} lng={o.pickupLng} label="pickup" />
                      </div>
                      <div className="flex items-start gap-1.5">
                        <MapPin className="h-3 w-3 text-emerald-400 mt-0.5 shrink-0" />
                        <span className="text-slate-300">
                          {formatLoc(o.dropoffAddress, o.dropoffParish)}
                        </span>
                        <MapLink lat={o.dropoffLat} lng={o.dropoffLng} label="drop-off" />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] uppercase tracking-wide text-slate-600">
                        {where}
                      </span>
                      {driver && (
                        <span className="flex items-center gap-1 text-[11px] text-slate-400">
                          <Truck className="h-3 w-3" /> {driver.name}
                        </span>
                      )}
                      {o.status === "cancel_requested" && (
                        <button
                          onClick={() => {
                            if (window.confirm(`Approve the cancellation of ${o.id}?`))
                              onApproveCancel(o.id);
                          }}
                          className="ml-auto text-[11px] bg-red-500/10 border border-red-900/60 text-red-300 hover:bg-red-500/20 rounded px-2 py-1 transition-colors"
                        >
                          Approve cancel
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (window.confirm(`Cancel ${o.id}? The driver's route for it will be cleared.`))
                            onCancelOrder(o.id);
                        }}
                        className={"text-[11px] text-red-400 hover:text-red-300 " + (o.status === "cancel_requested" ? "" : "ml-auto")}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Fleet tab: all drivers in a compact grid */}
      {tab === "fleet" && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {drivers.length === 0 ? (
            <p className="text-xs text-slate-600 border border-dashed border-slate-800 rounded-lg text-center p-6 md:col-span-2 xl:col-span-3">
              No drivers yet — use “Add driver” above.
            </p>
          ) : (
            drivers.map((driver) => {
              const pending = driver.stops.filter((s) => !s.done);
              const displayStatus =
                driver.displayStatus ||
                (pending.length ? "on-route" : driver.status === "off-duty" ? "off-duty" : "available");
              return (
                <div key={driver.id} className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-slate-800 flex items-center justify-center">
                      <Truck className="h-4 w-4 text-slate-300" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium leading-tight">{driver.name}</div>
                      <div className="text-xs text-slate-500 truncate">
                        {[driver.vehicle, driver.regNumber].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <div className="ml-auto">
                      <StatusBadge status={displayStatus} />
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 mt-3">
                    {pending.length} stop{pending.length === 1 ? "" : "s"} pending
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Add order / add driver — modals reachable from the header anywhere */}
      <Modal
        open={showAddOrder}
        title="New order"
        onClose={() => setShowAddOrder(false)}
      >
        <AddOrderForm
          onAdd={(orderData) => {
            onAddOrder(orderData);
            setShowAddOrder(false);
          }}
          onClose={() => setShowAddOrder(false)}
        />
      </Modal>
      <Modal
        open={showAddDriver}
        title="New fleet driver"
        onClose={() => setShowAddDriver(false)}
        wide
      >
        <AddDriverForm
          token={token}
          onAdd={(driverData) => {
            onAddDriver(driverData);
            setShowAddDriver(false);
          }}
          onClose={() => setShowAddDriver(false)}
        />
      </Modal>

      <Lightbox src={photoLightbox} alt="Pickup photo" onClose={() => setPhotoLightbox(null)} />
    </div>
  );
}

function UnassignedCard({ order, onCancel, onSaveNotes, onFetchOrderHistory }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        // Don't start a drag while typing in the notes editor
        if (e.target.closest("input,textarea")) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData(
          "application/json",
          JSON.stringify({ kind: "order", orderId: order.id })
        );
      }}
      className="bg-slate-900 border border-slate-800 rounded-md p-3 cursor-grab active:cursor-grabbing hover:border-emerald-500/60 transition-colors"
    >
      <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2">
        <GripVertical className="h-3.5 w-3.5" />
        <span>{order.customerName}</span>
        <button
          onClick={() => {
            if (window.confirm(`Cancel ${order.id}?`)) onCancel(order.id);
          }}
          className="ml-auto text-red-400 hover:text-red-300"
          title="Cancel order"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-start gap-2 text-xs mb-1">
        <Package className="h-3.5 w-3.5 text-blue-400 mt-0.5 shrink-0" />
        <span>{formatLoc(order.pickupAddress, order.pickupParish)}</span>
        <MapLink lat={order.pickupLat} lng={order.pickupLng} label="pickup" />
      </div>
      <div className="flex items-start gap-2 text-xs">
        <MapPin className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
        <span>{formatLoc(order.dropoffAddress, order.dropoffParish)}</span>
        <MapLink lat={order.dropoffLat} lng={order.dropoffLng} label="drop-off" />
      </div>
      <DispatchOrderNotes
        order={order}
        onSave={onSaveNotes}
        onFetchHistory={onFetchOrderHistory}
      />
    </div>
  );
}

function ReassignInline({ order, drivers, onReassign }) {
  const [driverId, setDriverId] = useState("");
  const options = drivers.filter(
    (d) => d.id !== order.driverId && d.status !== "off-duty"
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!driverId) return;
        onReassign(order.id, driverId);
        setDriverId("");
      }}
      className="flex items-center gap-1.5"
    >
      <select
        value={driverId}
        onChange={(e) => setDriverId(e.target.value)}
        className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
        className="text-[11px] bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-medium rounded px-2 py-1 transition-colors"
      >
        Reassign
      </button>
    </form>
  );
}

function PricingCard({ order, onPrice, onSaveNotes, onFetchOrderHistory }) {
  const [cost, setCost] = useState("");
  const value = parseFloat(cost);
  const isValid = cost !== "" && !Number.isNaN(value) && value > 0;

  const [paying, setPaying] = useState(!!order.paying);
  const [payAmount, setPayAmount] = useState(order.payAmount ?? "");
  const [collecting, setCollecting] = useState(!!order.collecting);
  const [collectAmount, setCollectAmount] = useState(order.collectAmount ?? "");

  const payAmountValid = paying && (payAmount === "" || (!Number.isNaN(parseFloat(payAmount)) && parseFloat(payAmount) >= 0));
  const collectAmountValid = collecting && (collectAmount === "" || (!Number.isNaN(parseFloat(collectAmount)) && parseFloat(collectAmount) >= 0));

  function buildPayload() {
    const body = { cost: value };
    if (paying !== order.paying) body.paying = paying;
    if (paying && payAmount !== "") body.payAmount = parseFloat(payAmount) || 0;
    if (collecting !== order.collecting) body.collecting = collecting;
    if (collecting && collectAmount !== "") body.collectAmount = parseFloat(collectAmount) || 0;
    return body;
  }

  return (
    <div className="bg-slate-900 border border-emerald-900/60 rounded-md p-3">
      <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2">
        <span>{order.customerName}</span>
        <span className="ml-auto">{order.createdAt}</span>
      </div>
      <div className="flex items-start gap-2 text-xs mb-1">
        <Package className="h-3.5 w-3.5 text-blue-400 mt-0.5 shrink-0" />
        <span>{formatLoc(order.pickupAddress, order.pickupParish)}</span>
        <MapLink lat={order.pickupLat} lng={order.pickupLng} label="pickup" />
      </div>
      <div className="flex items-start gap-2 text-xs mb-3">
        <MapPin className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
        <span>{formatLoc(order.dropoffAddress, order.dropoffParish)}</span>
        <MapLink lat={order.dropoffLat} lng={order.dropoffLng} label="drop-off" />
      </div>
      {order.notes && (
        <p className="text-xs text-slate-500 mb-3">"{order.notes}"</p>
      )}
      <DispatchOrderNotes
        order={order}
        onSave={onSaveNotes}
        onFetchHistory={onFetchOrderHistory}
      />

      <div className="space-y-2 mb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPaying((v) => !v)}
            className={
              "shrink-0 text-xs border rounded-md px-2 py-1 transition-colors " +
              (paying ? "bg-emerald-950/40 border-emerald-800 text-emerald-300" : "bg-slate-800 border-slate-700 text-slate-400")
            }
          >
            Paying
          </button>
          {paying && (
            <div>
              <label className="text-[10px] text-slate-500 mr-1">Amount ($)</label>
              <input
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                className="w-28 bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCollecting((v) => !v)}
            className={
              "shrink-0 text-xs border rounded-md px-2 py-1 transition-colors " +
              (collecting ? "bg-emerald-950/40 border-emerald-800 text-emerald-300" : "bg-slate-800 border-slate-700 text-slate-400")
            }
          >
            Collecting cash
          </button>
          {collecting && (
            <div>
              <label className="text-[10px] text-slate-500 mr-1">Amount ($)</label>
              <input
                value={collectAmount}
                onChange={(e) => setCollectAmount(e.target.value)}
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                className="w-28 bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          )}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!isValid) return;
          onPrice(order.id, buildPayload());
          setCost("");
        }}
        className="flex items-center gap-2"
      >
        <div className="relative flex-1">
          <DollarSign className="h-3.5 w-3.5 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            className="w-full bg-slate-950 border border-slate-800 rounded-md pl-7 pr-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <button
          type="submit"
          disabled={!isValid}
          className="shrink-0 text-xs bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-medium rounded-md px-3 py-1.5 transition-colors"
        >
          Approve
        </button>
      </form>
    </div>
  );
}

function AddDriverForm({ token, onAdd, onClose }) {
  // Fleet drivers must be backed by a driver-role user account — the server
  // takes userId, not a free-form name (same flow as the admin Drivers tab).
  const [userId, setUserId] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [regNumber, setRegNumber] = useState("");
  const [model, setModel] = useState("");
  const [colour, setColour] = useState("");
  const [description, setDescription] = useState("");
  const [eligibleUsers, setEligibleUsers] = useState(null);

  useEffect(() => {
    let alive = true;
    api
      .eligibleDriverUsers(token)
      .catch(() => [])
      .then((users) => {
        if (alive) setEligibleUsers(users || []);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!userId) return;
        onAdd({
          userId,
          vehicle: vehicle.trim() || "Vehicle",
          regNumber: regNumber.trim() || null,
          model: model.trim() || null,
          colour: colour.trim() || null,
          description: description.trim() || null,
        });
      }}
      className="space-y-2"
    >
      {eligibleUsers === null ? (
        <p className="text-xs text-slate-500">Loading driver accounts…</p>
      ) : eligibleUsers.length === 0 ? (
        <p className="text-xs text-slate-500">
          No unlinked driver accounts available. Ask an admin to create a user
          with the <span className="text-slate-300">Driver</span> role first.
        </p>
      ) : (
        <>
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-1">
              Driver account
            </label>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
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
          <div className="grid grid-cols-2 gap-2">
            <input
              value={vehicle}
              onChange={(e) => setVehicle(e.target.value)}
              placeholder="Vehicle type"
              className={inputClass}
            />
            <input
              value={regNumber}
              onChange={(e) => setRegNumber(e.target.value)}
              placeholder="Reg number"
              className={inputClass}
              style={fontMono}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Model"
              className={inputClass}
            />
            <input
              value={colour}
              onChange={(e) => setColour(e.target.value)}
              placeholder="Colour"
              className={inputClass}
            />
          </div>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className={inputClass}
          />
          <button
            type="submit"
            disabled={!userId}
            className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 rounded py-1.5 text-xs font-medium"
          >
            Add driver
          </button>
        </>
      )}
    </form>
  );
}

function AddOrderForm({ onAdd, onClose }) {
  const [customerName, setCustomerName] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [pickupParish, setPickupParish] = useState("");
  const [pickupPin, setPickupPin] = useState(false);
  const [pickupLat, setPickupLat] = useState("");
  const [pickupLng, setPickupLng] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [dropoffParish, setDropoffParish] = useState("");
  const [dropoffPin, setDropoffPin] = useState(false);
  const [dropoffLat, setDropoffLat] = useState("");
  const [dropoffLng, setDropoffLng] = useState("");
  const [notes, setNotes] = useState("");
  const [locLoading, setLocLoading] = useState({ pickup: false, dropoff: false });

  function useLocation(type) {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }
    setLocLoading((l) => ({ ...l, [type]: true }));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const latStr = String(pos.coords.latitude);
        const lngStr = String(pos.coords.longitude);
        if (type === "pickup") { setPickupLat(latStr); setPickupLng(lngStr); }
        else { setDropoffLat(latStr); setDropoffLng(lngStr); }
        setLocLoading((l) => ({ ...l, [type]: false }));
      },
      (err) => {
        alert("Could not get location: " + err.message);
        setLocLoading((l) => ({ ...l, [type]: false }));
      }
    );
  }

  const smallInput = inputClass + " text-xs";
  const pinToggleClass = (active) =>
    "mt-1 flex items-center gap-1 text-[11px] transition-colors " +
    (active ? "text-emerald-400 hover:text-emerald-300" : "text-slate-500 hover:text-slate-300");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!customerName.trim() || !pickupAddress.trim() || !dropoffAddress.trim()) return;
        onAdd({
          customerName: customerName.trim(),
          pickupAddress: pickupAddress.trim(),
          pickupParish: pickupParish || null,
          pickupLat: pickupPin && pickupLat !== "" ? parseFloat(pickupLat) : null,
          pickupLng: pickupPin && pickupLng !== "" ? parseFloat(pickupLng) : null,
          dropoffAddress: dropoffAddress.trim(),
          dropoffParish: dropoffParish || null,
          dropoffLat: dropoffPin && dropoffLat !== "" ? parseFloat(dropoffLat) : null,
          dropoffLng: dropoffPin && dropoffLng !== "" ? parseFloat(dropoffLng) : null,
          notes: notes.trim(),
        });
      }}
      className="mt-2 bg-slate-900 border border-emerald-900/50 rounded-md p-3 space-y-2"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-300 font-medium">New order</span>
        <button type="button" onClick={onClose}>
          <X className="h-3.5 w-3.5 text-slate-500" />
        </button>
      </div>

      <input
        value={customerName}
        onChange={(e) => setCustomerName(e.target.value)}
        placeholder="Customer / walk-in name"
        className={smallInput}
        required
      />

      {/* Pickup */}
      <div>
        <label className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">
          <Package className="h-2.5 w-2.5 text-blue-400" /> Pickup
        </label>
        <input
          value={pickupAddress}
          onChange={(e) => setPickupAddress(e.target.value)}
          placeholder="Pickup address"
          className={smallInput}
          required
        />
        <select
          value={pickupParish}
          onChange={(e) => setPickupParish(e.target.value)}
          className={smallInput + " mt-1"}
        >
          <option value="">Parish (optional)</option>
          {PARISHES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button type="button" onClick={() => setPickupPin((v) => !v)} className={pinToggleClass(pickupPin)}>
          <MapPin className="h-2.5 w-2.5" />
          {pickupPin ? "Remove pickup pin" : "Add GPS pin"}
        </button>
        {pickupPin && (
          <div className="mt-1.5 bg-slate-950 border border-slate-800 rounded-md p-2 space-y-1">
            <div className="grid grid-cols-2 gap-1">
              <input value={pickupLat} onChange={(e) => setPickupLat(e.target.value)}
                placeholder="Lat" type="number" step="any" className={smallInput} />
              <input value={pickupLng} onChange={(e) => setPickupLng(e.target.value)}
                placeholder="Lng" type="number" step="any" className={smallInput} />
            </div>
            <button type="button" onClick={() => useLocation("pickup")}
              disabled={locLoading.pickup}
              className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 disabled:opacity-50 transition-colors">
              <MapPin className="h-2.5 w-2.5" />{locLoading.pickup ? "Getting…" : "My location"}
            </button>
          </div>
        )}
      </div>

      {/* Drop-off */}
      <div>
        <label className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">
          <MapPin className="h-2.5 w-2.5 text-emerald-400" /> Drop-off
        </label>
        <input
          value={dropoffAddress}
          onChange={(e) => setDropoffAddress(e.target.value)}
          placeholder="Drop-off address"
          className={smallInput}
          required
        />
        <select
          value={dropoffParish}
          onChange={(e) => setDropoffParish(e.target.value)}
          className={smallInput + " mt-1"}
        >
          <option value="">Parish (optional)</option>
          {PARISHES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button type="button" onClick={() => setDropoffPin((v) => !v)} className={pinToggleClass(dropoffPin)}>
          <MapPin className="h-2.5 w-2.5" />
          {dropoffPin ? "Remove drop-off pin" : "Add GPS pin"}
        </button>
        {dropoffPin && (
          <div className="mt-1.5 bg-slate-950 border border-slate-800 rounded-md p-2 space-y-1">
            <div className="grid grid-cols-2 gap-1">
              <input value={dropoffLat} onChange={(e) => setDropoffLat(e.target.value)}
                placeholder="Lat" type="number" step="any" className={smallInput} />
              <input value={dropoffLng} onChange={(e) => setDropoffLng(e.target.value)}
                placeholder="Lng" type="number" step="any" className={smallInput} />
            </div>
            <button type="button" onClick={() => useLocation("dropoff")}
              disabled={locLoading.dropoff}
              className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 disabled:opacity-50 transition-colors">
              <MapPin className="h-2.5 w-2.5" />{locLoading.dropoff ? "Getting…" : "My location"}
            </button>
          </div>
        )}
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        rows={2}
        className={smallInput + " resize-none"}
      />
      <button
        type="submit"
        className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded py-1.5 text-xs font-medium"
      >
        Create order
      </button>
    </form>
  );
}

function DriverColumn({
  driver,
  performDrop,
  onToggleStop,
  onOpenPhoto,
  onSaveNote,
  onRemoveDriverNote,
  onFetchHistory,
  dragOverTarget,
  setDragOverTarget,
  getDragData,
  editing,
  onEdit,
  onUpdateDriver,
  onSetAvailability,
}) {
  const isOver = dragOverTarget && dragOverTarget.driverId === driver.id;
  const pending = driver.stops.filter((s) => !s.done);
  const displayStatus =
    driver.displayStatus ||
    (pending.length ? "on-route" : driver.status === "off-duty" ? "off-duty" : "available");
  const offDuty = displayStatus === "off-duty";

  return (
    <div
      className={
        "w-80 shrink-0 bg-slate-900 border border-slate-800 rounded-lg flex flex-col " +
        (offDuty ? "opacity-70" : "")
      }
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => setDragOverTarget(null)}
      onDrop={(e) => {
        e.preventDefault();
        const data = getDragData(e);
        const idx =
          dragOverTarget && dragOverTarget.driverId === driver.id
            ? dragOverTarget.index
            : null;
        performDrop(driver.id, idx, data);
        setDragOverTarget(null);
      }}
    >
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-slate-800 flex items-center justify-center">
              <Truck className="h-4 w-4 text-slate-300" />
            </div>
            <div>
              <div className="text-sm font-medium leading-tight">
                {driver.name}
              </div>
              <div className="text-xs text-slate-500 leading-tight">
                {[driver.vehicle, driver.regNumber].filter(Boolean).join(" · ")}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="text-right">
              <StatusBadge status={displayStatus} />
              {driver.statusUpdatedAt && (
                <div className="text-[10px] text-slate-500 mt-0.5">
                  since {fmtTime(driver.statusUpdatedAt)}
                </div>
              )}
            </div>
            <button
              onClick={onEdit}
              className={
                "h-7 w-7 rounded-md flex items-center justify-center transition-colors " +
                (editing
                  ? "bg-slate-800 text-emerald-400"
                  : "text-slate-500 hover:text-slate-200 hover:bg-slate-800")
              }
              title="Edit driver"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {offDuty && (
          <div className="text-[11px] text-slate-500 mt-1.5">
            Off duty{driver.statusUpdatedAt ? ` since ${fmtTime(driver.statusUpdatedAt)}` : ""} — not accepting jobs right now
          </div>
        )}
        <div className="text-xs text-slate-500 mt-2">
          {pending.length} stops remaining
        </div>
        {editing && (
          <EditDriverForm
            driver={driver}
            onUpdate={onUpdateDriver}
            onSetAvailability={onSetAvailability}
          />
        )}
      </div>

      <div
        className={
          "flex-1 p-2 space-y-1 min-h-[120px] " +
          (isOver && dragOverTarget.index === driver.stops.length
            ? "bg-slate-800/40"
            : "")
        }
      >
        {driver.stops.length === 0 && (
          <p className="text-xs text-slate-600 text-center p-6">
            Drag an order here to assign it
          </p>
        )}
        {driver.stops.map((stop, index) => (
          <React.Fragment key={stop.id}>
            {isOver && dragOverTarget.index === index && (
              <div className="h-0.5 bg-emerald-500 rounded-full mx-1" />
            )}
            <StopRow
              stop={stop}
              index={index}
              driverId={driver.id}
              onToggleStop={onToggleStop}
              onOpenPhoto={onOpenPhoto}
              onSaveNote={onSaveNote}
              onRemoveDriverNote={onRemoveDriverNote}
              onFetchHistory={onFetchHistory}
              setDragOverTarget={setDragOverTarget}
            />
          </React.Fragment>
        ))}
        {isOver && dragOverTarget.index === driver.stops.length && (
          <div className="h-0.5 bg-emerald-500 rounded-full mx-1" />
        )}
      </div>
    </div>
  );
}

function EditDriverForm({ driver, onUpdate, onSetAvailability }) {
  const [name, setName] = useState(driver.name || "");
  const [vehicle, setVehicle] = useState(driver.vehicle || "");
  const [regNumber, setRegNumber] = useState(driver.regNumber || "");
  const [model, setModel] = useState(driver.model || "");
  const [colour, setColour] = useState(driver.colour || "");
  const [description, setDescription] = useState(driver.description || "");
  const pending = driver.stops.filter((s) => !s.done);

  const canSave =
    name.trim() &&
    vehicle.trim() &&
    (name.trim() !== driver.name ||
      vehicle.trim() !== driver.vehicle ||
      regNumber.trim() !== (driver.regNumber || "") ||
      model.trim() !== (driver.model || "") ||
      colour.trim() !== (driver.colour || "") ||
      description.trim() !== (driver.description || ""));

  return (
    <div className="mt-3 pt-3 border-t border-slate-800 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-500">Availability</span>
        <div className="flex bg-slate-950 border border-slate-800 rounded-full p-0.5">
          <button
            onClick={() => onSetAvailability(driver.id, true)}
            className={
              "px-2.5 py-1 text-[11px] rounded-full transition-colors " +
              (driver.status !== "off-duty"
                ? "bg-emerald-400 text-slate-950 font-medium"
                : "text-slate-500")
            }
          >
            Available
          </button>
          <button
            onClick={() => onSetAvailability(driver.id, false)}
            disabled={pending.length > 0}
            className={
              "px-2.5 py-1 text-[11px] rounded-full transition-colors disabled:opacity-40 " +
              (driver.status === "off-duty"
                ? "bg-slate-700 text-slate-200 font-medium"
                : "text-slate-500")
            }
          >
            Off duty
          </button>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSave) return;
          onUpdate(driver.id, {
            name: name.trim(),
            vehicle: vehicle.trim(),
            regNumber: regNumber.trim() || null,
            model: model.trim() || null,
            colour: colour.trim() || null,
            description: description.trim() || null,
          });
        }}
        className="space-y-2"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Driver name"
          className={inputClass}
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            value={vehicle}
            onChange={(e) => setVehicle(e.target.value)}
            placeholder="Vehicle type"
            className={inputClass}
          />
          <input
            value={regNumber}
            onChange={(e) => setRegNumber(e.target.value)}
            placeholder="Reg number"
            className={inputClass}
            style={fontMono}
          />
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Model"
            className={inputClass}
          />
          <input
            value={colour}
            onChange={(e) => setColour(e.target.value)}
            placeholder="Colour"
            className={inputClass}
          />
        </div>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
          className={inputClass}
        />
        <button
          type="submit"
          disabled={!canSave}
          className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 rounded py-1.5 text-xs font-medium transition-colors"
        >
          Save changes
        </button>
      </form>
    </div>
  );
}

function StopRow({
  stop,
  index,
  driverId,
  onToggleStop,
  onOpenPhoto,
  setDragOverTarget,
  onSaveNote,
  onRemoveDriverNote,
  onFetchHistory,
}) {
  const isPickup = stop.type === "pickup";
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [history, setHistory] = useState([]);
  const note = (stop.notes || "").trim();
  const driverNote = (stop.driverNote || "").trim();

  // Load the note audit trail whenever the editor opens.
  useEffect(() => {
    if (!editingNote) return;
    let alive = true;
    onFetchHistory?.({ stopId: stop.id }).then((h) => {
      if (alive) setHistory(h || []);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingNote, stop.id]);

  function openNoteEditor() {
    setNoteDraft(note);
    setEditingNote(true);
  }

  function submitNote(e) {
    e.preventDefault();
    if (noteDraft.trim() !== note) onSaveNote(stop.id, noteDraft.trim());
    setEditingNote(false);
  }

  return (
    <div
      draggable
      onDragStart={(e) => {
        // Don't start a drag while typing/selecting in the note editor
        if (editingNote) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData(
          "application/json",
          JSON.stringify({
            kind: "stop",
            stopId: stop.id,
            sourceDriverId: driverId,
            orderId: stop.orderId,
          })
        );
      }}
      onDragOver={(e) => {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        setDragOverTarget({
          driverId,
          index: before ? index : index + 1,
        });
      }}
      className={
        "group flex items-center gap-2 rounded-md px-2 py-2 cursor-grab active:cursor-grabbing border " +
        (stop.done
          ? "border-transparent opacity-50"
          : "border-transparent hover:border-slate-700 hover:bg-slate-800/60")
      }
    >
      <GripVertical className="h-3.5 w-3.5 text-slate-600 shrink-0" />
      <span
        className="text-xs text-slate-500 w-4 shrink-0 text-center"
        style={fontMono}
      >
        {index + 1}
      </span>
      {isPickup ? (
        <Package className="h-3.5 w-3.5 text-blue-400 shrink-0" />
      ) : (
        <MapPin className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div
          className={
            "text-xs truncate " +
            (stop.done ? "line-through text-slate-500" : "")
          }
        >
          {stop.address}
        </div>
        <div className="text-[11px] text-slate-500 truncate">
          {isPickup ? "Pickup" : "Drop-off"} &middot; {stop.customerName}
        </div>
        {!editingNote && note && (
          <button
            type="button"
            onClick={openNoteEditor}
            title="Edit the note the driver sees at this stop"
            className="mt-1 flex items-start gap-1 text-[11px] text-emerald-200/90 hover:text-emerald-100 text-left max-w-full"
          >
            <StickyNote className="h-3 w-3 text-emerald-300 shrink-0 mt-0.5" />
            <span className="line-clamp-2 leading-snug break-words">
              {note}
              {stop.notesUpdatedAt && (
                <span className="text-[10px] text-emerald-400/70 ml-1">
                  · {fmtTime(stop.notesUpdatedAt)}
                </span>
              )}
            </span>
          </button>
        )}
        {!editingNote && driverNote && (
          <div className="mt-1 flex items-start gap-1 text-[11px] text-sky-200/90 leading-snug">
            <MessageSquare className="h-3 w-3 text-sky-300 shrink-0 mt-0.5" />
            <span className="min-w-0 break-words">
              <span className="font-medium text-sky-300">Driver: </span>
              {driverNote}
              {stop.driverNoteUpdatedAt && (
                <span className="text-[10px] text-sky-400/70 ml-1">
                  · {fmtTime(stop.driverNoteUpdatedAt)}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => onRemoveDriverNote?.(stop.id, "")}
              title="Clear the driver's note"
              className="ml-auto shrink-0 text-slate-500 hover:text-red-400"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        {editingNote ? (
          <form onSubmit={submitNote} className="mt-1.5 space-y-1.5">
            <textarea
              autoFocus
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={2}
              placeholder="Note for the driver at this stop — gate code, call ahead, package care…"
              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-[11px] leading-snug resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <div className="flex items-center gap-1.5">
              <button
                type="submit"
                disabled={noteDraft.trim() === note}
                className="text-[11px] bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-medium rounded px-2 py-0.5 transition-colors"
              >
                Save
              </button>
              {note && (
                <button
                  type="button"
                  onClick={() => {
                    onSaveNote(stop.id, "");
                    setEditingNote(false);
                  }}
                  className="text-[11px] text-red-400 hover:text-red-300"
                >
                  Remove
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditingNote(false)}
                className="text-[11px] text-slate-500 hover:text-slate-300"
              >
                Cancel
              </button>
            </div>
            {history.length > 0 && (
              <div className="pt-1.5 border-t border-slate-800 mt-1">
                <div className="text-[10px] uppercase tracking-wide text-slate-600 mb-1">
                  Note history
                </div>
                <ul className="space-y-1">
                  {history.map((h) => (
                    <li
                      key={h.id}
                      className="text-[10px] text-slate-500 leading-snug"
                    >
                      <span className="text-slate-300">{h.actorName}</span>
                      <span className="text-slate-600">
                        {" "}({h.actorRole})
                      </span>{" "}
                      {h.next
                        ? h.prev
                          ? "changed to "
                          : "added "
                        : "removed the note"}
                      {h.next ? `“${h.next}”` : ""}
                      <span className="text-slate-600"> · {fmtClock(h.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </form>
        ) : (
          <div className="flex items-center gap-1.5 mt-0.5">
            {!note && (
              <button
                type="button"
                onClick={openNoteEditor}
                title="Add a note for the driver at this stop"
                className="inline-flex items-center gap-0.5 text-[11px] text-slate-600 hover:text-emerald-300 transition-colors"
              >
                <StickyNote className="h-2.5 w-2.5" /> add note
              </button>
            )}
            {stop.done && stop.completedAt && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-emerald-400/90">
                <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400" /> completed {fmtTime(stop.completedAt)}
              </span>
            )}
            {stop.enRoute && !stop.done && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-emerald-400">
                <Navigation className="h-2.5 w-2.5" /> on the way{stop.enRouteAt ? ` · ${fmtTime(stop.enRouteAt)}` : ""}
              </span>
            )}
            {isPickup &&
              (stop.photoUrl ? (
                <button
                  type="button"
                  onClick={() => onOpenPhoto?.(stop.photoUrl)}
                  title={`View pickup photo${stop.photoUploadedAt ? ` (uploaded ${fmtTime(stop.photoUploadedAt)})` : ""}`}
                  className="inline-flex items-center gap-1 text-[11px] text-blue-300 hover:text-blue-200"
                >
                  <img
                    src={stop.photoUrl}
                    alt="Pickup photo"
                    className="h-6 w-6 rounded object-cover border border-slate-700 bg-slate-800"
                  />
                  <Camera className="h-2.5 w-2.5" />
                  photo{stop.photoUploadedAt ? ` · ${fmtTime(stop.photoUploadedAt)}` : ""}
                </button>
              ) : (
                <span
                  className="inline-flex items-center gap-1 text-[11px] text-slate-600"
                  title="Driver must attach a proof-of-pickup photo before completing this stop"
                >
                  <CameraOff className="h-2.5 w-2.5" />
                  no photo
                </span>
              ))}
          </div>
        )}
      </div>
      <button
        onClick={() => onToggleStop(stop.id)}
        className="shrink-0 text-slate-500 hover:text-emerald-400"
        title={stop.done ? "Mark not done" : "Mark done"}
      >
        {stop.done ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        ) : stop.enRoute ? (
          <Navigation className="h-4 w-4 text-emerald-400 animate-pulse" />
        ) : (
          <Circle className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

// Editable pickup / drop-off notes on an order, for use before the job is assigned
// (needs-pricing cards and the unassigned pool). The same notes become the stop
// notes drivers see once the order is assigned.
function DispatchOrderNotes({ order, onSave, onFetchHistory }) {
  const [open, setOpen] = useState(false);
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [history, setHistory] = useState([]);
  const pickupNote = (order.pickupNote || "").trim();
  const dropoffNote = (order.dropoffNote || "").trim();
  const hasNotes = !!(pickupNote || dropoffNote);
  const changed = pickup.trim() !== pickupNote || dropoff.trim() !== dropoffNote;

  function beginEdit() {
    setPickup(pickupNote);
    setDropoff(dropoffNote);
    setOpen(true);
    onFetchHistory?.({ orderId: order.id }).then((h) => setHistory(h || []));
  }

  function submit(e) {
    e.preventDefault();
    if (changed) {
      onSave(order.id, {
        pickupNote: pickup.trim(),
        dropoffNote: dropoff.trim(),
      });
    }
    setOpen(false);
  }

  return (
    <div className="mt-2 mb-3">
      {!open ? (
        <>
          {hasNotes && (
            <div className="mb-1.5 space-y-0.5">
              {pickupNote && (
                <div className="flex items-start gap-1 text-[11px] text-emerald-200/90">
                  <Package className="h-2.5 w-2.5 text-blue-400 mt-0.5 shrink-0" />
                  <span className="min-w-0 break-words">
                    <span className="font-medium text-blue-300">Pickup: </span>
                    {pickupNote}
                    {order.notesUpdatedAt && (
                      <span className="text-[10px] text-slate-500 ml-1">
                        · {fmtTime(order.notesUpdatedAt)}
                      </span>
                    )}
                  </span>
                </div>
              )}
              {dropoffNote && (
                <div className="flex items-start gap-1 text-[11px] text-emerald-200/90">
                  <MapPin className="h-2.5 w-2.5 text-emerald-400 mt-0.5 shrink-0" />
                  <span className="min-w-0 break-words">
                    <span className="font-medium text-emerald-300">Drop-off: </span>
                    {dropoffNote}
                    {order.notesUpdatedAt && (
                      <span className="text-[10px] text-slate-500 ml-1">
                        · {fmtTime(order.notesUpdatedAt)}
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={beginEdit}
            className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-emerald-300 transition-colors"
          >
            <StickyNote className="h-3 w-3" />
            {hasNotes
              ? "Edit pickup / drop-off notes"
              : "Add pickup / drop-off notes"}
          </button>
        </>
      ) : (
        <form onSubmit={submit} className="space-y-1.5">
          <div>
            <label className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">
              <Package className="h-2.5 w-2.5 text-blue-400" /> Pickup note
            </label>
            <input
              value={pickup}
              onChange={(e) => setPickup(e.target.value)}
              placeholder="Note for the driver at pickup…"
              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">
              <MapPin className="h-2.5 w-2.5 text-emerald-400" /> Drop-off note
            </label>
            <input
              value={dropoff}
              onChange={(e) => setDropoff(e.target.value)}
              placeholder="Note for the driver at drop-off…"
              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="submit"
              disabled={!changed}
              className="text-[11px] bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-medium rounded px-2 py-0.5 transition-colors"
            >
              Save
            </button>
            {hasNotes && (
              <button
                type="button"
                onClick={() => {
                  onSave(order.id, { pickupNote: "", dropoffNote: "" });
                  setOpen(false);
                }}
                className="text-[11px] text-red-400 hover:text-red-300"
              >
                Remove
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[11px] text-slate-500 hover:text-slate-300"
            >
              Cancel
            </button>
          </div>
          {history.length > 0 && (
            <div className="pt-1.5 border-t border-slate-800">
              <div className="text-[10px] uppercase tracking-wide text-slate-600 mb-1">
                Note history
              </div>
              <ul className="space-y-1">
                {history.map((h) => (
                  <li
                    key={h.id}
                    className="text-[10px] text-slate-500 leading-snug"
                  >
                    <span className="text-slate-300">{h.actorName}</span>
                    <span className="text-slate-600"> ({h.actorRole})</span>{" "}
                    {h.next
                      ? h.prev
                        ? "changed to "
                        : "added "
                      : "removed the note"}
                    {h.next ? `“${h.next}”` : ""}
                    <span className="text-slate-600">
                      {" "}· {fmtClock(h.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
