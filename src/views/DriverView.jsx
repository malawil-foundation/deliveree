import React, { useState, useEffect, useRef } from "react";
import {
  Package,
  MapPin,
  Truck,
  Lock,
  ArrowRight,
  Navigation,
  Pencil,
  X,
  AlertTriangle,
  Camera,
  StickyNote,
  MessageSquare,
  CheckCircle2,
  Wallet,
  ChevronDown,
  Bell,
} from "lucide-react";
import { api } from "../api.js";
import {
  fontHead,
  fontMono,
  StatusBadge,
  inputClass,
  btnPrimary,
  btnGhost,
  Lightbox,
  fmtTime,
} from "../components.jsx";

export default function DriverView({
  driver,
  orders,
  token,
  onToggleStop,
  onEnRoute,
  onUploadPhoto,
  onUpdateVehicle,
  onSetAvailability,
  onRequestCancel,
  onDriverNote,
}) {
  const [editing, setEditing] = useState(false);
  const [photoLightbox, setPhotoLightbox] = useState(null);

  if (!driver) {
    return (
      <div className="max-w-2xl mx-auto text-slate-500 text-sm border border-dashed border-slate-800 rounded-lg p-6 text-center">
        No fleet vehicle is linked to your driver account. Ask an admin to link
        one.
      </div>
    );
  }

  const pending = driver.stops.filter((s) => !s.done);
  const done = driver.stops.filter((s) => s.done);
  const displayStatus =
    driver.displayStatus ||
    (pending.length
      ? "on-route"
      : driver.status === "off-duty"
      ? "off-duty"
      : "available");
  const orderFor = (stop) => orders.find((o) => o.id === stop.orderId);

  return (
    <div className="max-w-2xl mx-auto">
      {/* header + vehicle card */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-full bg-slate-800 flex items-center justify-center">
            <Truck className="h-5 w-5 text-slate-300" />
          </div>
          <div className="min-w-0">
            <div className="font-medium" style={fontHead}>
              {driver.name}
            </div>
            <div className="text-xs text-slate-500 truncate">
              {[driver.vehicle, driver.model, driver.colour].filter(Boolean).join(" · ")}
              {driver.regNumber ? ` · ${driver.regNumber}` : ""}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="text-right">
              <StatusBadge status={displayStatus} />
              {driver.statusUpdatedAt && (
                <div className="text-[10px] text-slate-500 mt-0.5">
                  since {fmtTime(driver.statusUpdatedAt)}
                </div>
              )}
            </div>
            <NotificationsBell token={token} />
            <button
              onClick={() => setEditing((v) => !v)}
              className="h-8 w-8 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-800 transition-colors"
              title="Edit vehicle details"
            >
              {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {driver.description && (
          <p className="text-xs text-slate-500 mt-3">{driver.description}</p>
        )}

        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-slate-800/70">
          <button
            disabled={pending.length > 0}
            onClick={() => onSetAvailability(displayStatus !== "available")}
            className={
              "text-xs px-3 py-1.5 rounded-md font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed " +
              (displayStatus === "off-duty"
                ? "bg-emerald-400 text-slate-950 hover:bg-emerald-300"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700")
            }
          >
            {displayStatus === "off-duty" ? "Mark me available" : "Go off duty"}
          </button>
          {driver.statusUpdatedAt && (
            <span className="text-[11px] text-slate-500">
              {displayStatus === "off-duty" ? "Off duty" : "Available"} since {fmtTime(driver.statusUpdatedAt)}
            </span>
          )}
          {pending.length > 0 && (
            <span className="text-[11px] text-slate-500">
              · Availability unlocks once your stops are done
            </span>
          )}
        </div>

        {editing && (
          <VehicleForm
            driver={driver}
            onSave={(patch) => {
              onUpdateVehicle(patch);
              setEditing(false);
            }}
            onClose={() => setEditing(false)}
          />
        )}
      </div>

      <EarningsCard token={token} />

      {driver.stops.length === 0 ? (
        <div className="text-slate-500 text-sm border border-dashed border-slate-800 rounded-lg p-6 text-center">
          {displayStatus === "off-duty"
            ? "You're off duty. Mark yourself available when you can take jobs."
            : "No stops assigned right now."}
        </div>
      ) : (
        <>
          <h3 className="text-sm font-semibold text-slate-300 mb-2">
            {pending.length > 0
              ? `Current stop (${pending.length} remaining)`
              : "Route complete"}
          </h3>
          <div className="space-y-2 mb-6">
            {pending.length === 0 ? (
              <div className="text-slate-500 text-sm border border-dashed border-slate-800 rounded-lg p-6 text-center">
                All stops complete. Nice work.
              </div>
            ) : (
              <>
                <DriverStopCard
                  stop={pending[0]}
                  order={orderFor(pending[0])}
                  position={driver.stops.indexOf(pending[0]) + 1}
                  isNext
                  onComplete={() => onToggleStop(pending[0].id)}
                  onEnRoute={() => onEnRoute(pending[0].id)}
                  onUploadPhoto={onUploadPhoto}
                  onOpenPhoto={setPhotoLightbox}
                  onRequestCancel={(reason) =>
                    onRequestCancel(pending[0].orderId, reason)
                  }
                  onDriverNote={(text) => onDriverNote(pending[0].id, text)}
                />
                {pending.length > 1 && (
                  <div className="flex items-center gap-3 rounded-lg border border-slate-800 border-dashed p-3 text-slate-500">
                    <Lock className="h-4 w-4 shrink-0" />
                    <div className="text-xs">
                      {pending.length - 1} more stop
                      {pending.length - 1 > 1 ? "s" : ""} queued — revealed
                      once this one is marked complete
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {done.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-slate-500 mb-2">
                Completed
              </h3>
              <div className="space-y-2">
                {done.map((stop) => (
                  <DriverStopCard
                    key={stop.id}
                    stop={stop}
                    position={driver.stops.indexOf(stop) + 1}
                    onComplete={() => onToggleStop(stop.id)}
                    onOpenPhoto={setPhotoLightbox}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
      <Lightbox
        src={photoLightbox}
        alt="Pickup photo"
        onClose={() => setPhotoLightbox(null)}
      />
    </div>
  );
}

function VehicleForm({ driver, onSave, onClose }) {
  const [vehicle, setVehicle] = useState(driver.vehicle || "");
  const [regNumber, setRegNumber] = useState(driver.regNumber || "");
  const [model, setModel] = useState(driver.model || "");
  const [colour, setColour] = useState(driver.colour || "");
  const [description, setDescription] = useState(driver.description || "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!vehicle.trim()) return;
        onSave({
          vehicle: vehicle.trim(),
          regNumber: regNumber.trim() || null,
          model: model.trim() || null,
          colour: colour.trim() || null,
          description: description.trim() || null,
        });
      }}
      className="mt-4 border-t border-slate-800 pt-4 space-y-3"
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Vehicle type</label>
          <input
            value={vehicle}
            onChange={(e) => setVehicle(e.target.value)}
            placeholder="e.g. Cargo Van"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">
            Registration number
          </label>
          <input
            value={regNumber}
            onChange={(e) => setRegNumber(e.target.value)}
            placeholder="e.g. BM 8841"
            className={inputClass}
            style={fontMono}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Model</label>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. Toyota Hiace"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Colour</label>
          <input
            value={colour}
            onChange={(e) => setColour(e.target.value)}
            placeholder="e.g. White"
            className={inputClass}
          />
        </div>
      </div>
      <div>
        <label className="block text-xs text-slate-500 mb-1">
          Description (optional)
        </label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Capacity, access notes, anything useful…"
          className={inputClass}
        />
      </div>
      <div className="flex items-center gap-2 justify-end">
        <button type="button" onClick={onClose} className={btnGhost + " px-3 py-1.5 text-xs"}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary + " px-4 py-1.5 text-xs"}>
          Save vehicle details
        </button>
      </div>
    </form>
  );
}

function DriverStopCard({
  stop,
  order,
  position,
  isNext,
  onComplete,
  onEnRoute,
  onUploadPhoto,
  onOpenPhoto,
  onRequestCancel,
  onDriverNote,
}) {
  const [editingOwn, setEditingOwn] = useState(false);
  const [ownDraft, setOwnDraft] = useState("");
  const isPickup = stop.type === "pickup";
  const ownNote = (stop.driverNote || "").trim();
  const showStart = isNext && !stop.done && onEnRoute;
  const showCancel =
    isNext &&
    !stop.done &&
    order &&
    onRequestCancel &&
    ["assigned", "cancel_requested"].includes(order.status);
  // A pickup needs its proof-of-pickup photo before the driver can complete it.
  const photoRequired = isNext && !stop.done && isPickup && onUploadPhoto;
  const needsPhoto = photoRequired && !stop.photoUrl;

  return (
    <div
      className={
        "rounded-lg border p-3 " +
        (stop.done
          ? "border-slate-800 opacity-60"
          : isNext
          ? "border-emerald-500/60 bg-emerald-500/5"
          : "border-slate-800 bg-slate-900")
      }
    >
      <div className="flex items-center gap-3">
        <span
          className="text-xs text-slate-500 w-5 text-center shrink-0"
          style={fontMono}
        >
          {position}
        </span>
        {isPickup ? (
          <Package className="h-4 w-4 text-blue-400 shrink-0" />
        ) : (
          <MapPin className="h-4 w-4 text-emerald-400 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div
            className={
              "text-sm truncate " +
              (stop.done ? "line-through text-slate-500" : "")
            }
          >
            {stop.address}
          </div>
          <div className="text-xs text-slate-500 truncate">
            {isPickup ? "Pick up from" : "Deliver to"} &middot; {stop.customerName}
          </div>
          {stop.done && stop.completedAt && (
            <div className="text-[11px] text-emerald-400/90 mt-1 flex items-center gap-1 font-medium">
              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              Completed at {fmtTime(stop.completedAt)}
            </div>
          )}
          {stop.notes && (
            <div className="mt-2 flex items-start gap-2 text-xs text-emerald-100/95 bg-emerald-500/15 border border-emerald-500/40 rounded-md px-2.5 py-1.5 leading-snug">
              <StickyNote className="h-3.5 w-3.5 text-emerald-300 shrink-0 mt-0.5" />
              <span>
                <span className="font-semibold text-emerald-300">
                  Dispatch note{stop.notesUpdatedAt ? ` (${fmtTime(stop.notesUpdatedAt)})` : ""}:{" "}
                </span>
                {stop.notes}
              </span>
            </div>
          )}
          {(ownNote || editingOwn) && (
            <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-sky-100/90 bg-sky-400/10 border border-sky-400/25 rounded-md px-2 py-1 leading-snug">
              <MessageSquare className="h-3 w-3 text-sky-300 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                {ownNote && !editingOwn && (
                  <p className="break-words">
                    <span className="font-medium text-sky-300">
                      Your note{stop.driverNoteUpdatedAt ? ` (${fmtTime(stop.driverNoteUpdatedAt)})` : ""}:{" "}
                    </span>
                    {ownNote}
                  </p>
                )}
                {isNext && onDriverNote && (
                  <button
                    type="button"
                    onClick={() => {
                      setOwnDraft(ownNote);
                      setEditingOwn((v) => !v);
                    }}
                    className={
                      "text-sky-300 hover:text-sky-200 underline decoration-dotted underline-offset-2 " +
                      (editingOwn
                        ? "text-slate-500 hover:text-slate-300 no-underline"
                        : "")
                    }
                  >
                    {editingOwn ? "Cancel editing" : "Edit your note"}
                  </button>
                )}
                {editingOwn && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (ownDraft.trim() !== ownNote) onDriverNote(ownDraft.trim());
                      setEditingOwn(false);
                    }}
                    className="mt-1.5 space-y-1.5"
                  >
                    <textarea
                      autoFocus
                      value={ownDraft}
                      onChange={(e) => setOwnDraft(e.target.value)}
                      rows={2}
                      placeholder="Tell the dispatcher anything about this stop — e.g. gate locked, package left with security…"
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-[11px] leading-snug resize-none focus:outline-none focus:ring-2 focus:ring-sky-400"
                    />
                    <div className="flex items-center gap-1.5">
                      <button
                        type="submit"
                        disabled={ownDraft.trim() === ownNote}
                        className="text-[11px] bg-sky-400 hover:bg-sky-300 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-medium rounded px-2 py-0.5 transition-colors"
                      >
                        Save
                      </button>
                      {ownNote && (
                        <button
                          type="button"
                          onClick={() => {
                            onDriverNote("");
                            setEditingOwn(false);
                          }}
                          className="text-[11px] text-red-400 hover:text-red-300"
                        >
                          Remove
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setEditingOwn(false)}
                        className="text-[11px] text-slate-500 hover:text-slate-300"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}
          {!ownNote && !editingOwn && isNext && onDriverNote && (
            <button
              type="button"
              onClick={() => {
                setOwnDraft(ownNote);
                setEditingOwn(true);
              }}
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-sky-300 hover:text-sky-200 transition-colors"
            >
              <MessageSquare className="h-3 w-3" />
              Add a note for the dispatcher
            </button>
          )}
          {stop.enRoute && !stop.done && (
            <div className="text-[11px] text-emerald-400 mt-1 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              On the way to this stop{stop.enRouteAt ? ` · started ${fmtTime(stop.enRouteAt)}` : ""}
            </div>
          )}
          {order?.status === "cancel_requested" && (
            <div className="text-[11px] text-orange-400 mt-1 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Cancellation pending — keep
              going until the dispatcher decides
            </div>
          )}
        </div>
        {isNext && !stop.done && !stop.enRoute && (
          <ArrowRight className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
        )}
        <div className="flex items-center gap-1.5 shrink-0">
          {showStart && !stop.enRoute && (
            <button
              onClick={onEnRoute}
              className="text-xs bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-medium rounded-md px-3 py-1.5 transition-colors flex items-center gap-1"
            >
              <Navigation className="h-3 w-3" /> On my way
            </button>
          )}
          {stop.enRoute && !stop.done && (
            <span className="text-[11px] text-emerald-400 bg-emerald-400/10 border border-emerald-400/30 rounded-md px-2 py-1 flex items-center gap-1">
              <Navigation className="h-3 w-3" /> En route{stop.enRouteAt ? ` · ${fmtTime(stop.enRouteAt)}` : ""}
            </span>
          )}
          {onComplete && (
            <button
              onClick={onComplete}
              disabled={needsPhoto}
              title={needsPhoto ? "Add a pickup photo first" : undefined}
              className={
                "text-xs px-3 py-1.5 rounded-md font-medium transition-colors " +
                (stop.done
                  ? "bg-slate-800 text-slate-400 hover:bg-slate-700"
                  : needsPhoto
                  ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                  : "bg-emerald-500 text-slate-950 hover:bg-emerald-400")
              }
            >
              {stop.done ? "Undo" : "Complete"}
            </button>
          )}
        </div>
        {showCancel && (
          <button
            onClick={() => {
              const reason = window.prompt(
                "Tell the dispatcher why you'd like to cancel this job (optional):"
              );
              if (reason !== null) onRequestCancel(reason || "");
            }}
            className="self-stretch flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300"
            title="Request cancellation"
          >
            <AlertTriangle className="h-3 w-3" />
            Request cancellation
          </button>
        )}
      </div>

      {/* proof-of-pickup photo */}
      {(isPickup && (stop.done || photoRequired)) && (
        <PickupPhoto
          stop={stop}
          onUpload={onUploadPhoto}
          onOpen={onOpenPhoto}
          showPicker={photoRequired}
        />
      )}
    </div>
  );
}

// Camera photos from phones are routinely 3–12 MB and can exceed the server's
// 8 MB cap — and some proxies kill the connection on oversized bodies instead
// of returning a 413, which the browser surfaces as "Failed to fetch".
// Downscale to a max 2000px edge and re-encode as JPEG before uploading.
const MAX_PHOTO_EDGE = 2000;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function shrinkImage(file) {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/") || file.type === "image/gif") {
      resolve(file); // not a shrinkable raster (or animated GIF) — send as-is
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (blob && blob.size < file.size) {
            resolve(new File([blob], file.name.replace(/\.jpe?g$/i, ".jpg"), { type: "image/jpeg" }));
          } else {
            resolve(file); // re-encode didn't help — send the original
          }
        },
        "image/jpeg",
        0.85
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file); // undecodable — let the server reject it with a clear error
    };
    img.src = url;
  });
}

function PickupPhoto({ stop, onUpload, onOpen, showPicker }) {
  const fileRef = React.useRef(null);
  const [busy, setBusy] = React.useState(false);

  async function handlePick(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      alert("Photo must be 8 MB or smaller.");
      return;
    }
    setBusy(true);
    try {
      const uploadable = await shrinkImage(file);
      await onUpload(stop.id, uploadable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 pl-8 flex items-center gap-3 flex-wrap">
      {stop.photoUrl ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpen?.(stop.photoUrl)}
            title="View pickup photo"
            className="block rounded-md overflow-hidden border border-slate-700 bg-slate-800 hover:ring-2 hover:ring-emerald-500/60 transition-shadow"
          >
            <img
              src={stop.photoUrl}
              alt="Pickup photo"
              className="h-12 w-12 object-cover"
            />
          </button>
          {stop.photoUploadedAt && (
            <span className="text-[11px] text-slate-400">
              Uploaded {fmtTime(stop.photoUploadedAt)}
            </span>
          )}
        </div>
      ) : (
        <span className="text-[11px] text-slate-500">No pickup photo yet</span>
      )}
      {showPicker && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePick}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current && fileRef.current.click()}
            disabled={busy}
            className={
              "text-[11px] rounded-md px-2.5 py-1.5 font-medium transition-colors flex items-center gap-1.5 disabled:opacity-60 " +
              (stop.photoUrl
                ? "border border-slate-700 text-slate-300 hover:bg-slate-800"
                : "bg-blue-500/15 border border-blue-500/40 text-blue-300 hover:bg-blue-500/25")
            }
          >
            <Camera className="h-3 w-3" />
            {busy
              ? "Uploading…"
              : stop.photoUrl
              ? "Replace photo"
              : "Add pickup photo"}
          </button>
          {!stop.photoUrl && (
            <span className="text-[11px] text-emerald-300/80">
              Required before marking this stop complete
            </span>
          )}
        </>
      )}
    </div>
  );
}

// ---------------- MY NOTIFICATIONS ----------------
// The driver's personal feed (payout alerts etc.). Shows a badge while there
// are unread items; opening the panel marks everything read. New arrivals also
// pop up as push-style toasts (bottom-right) even when the panel is closed, so
// a payout recorded mid-route is seen immediately. Hidden entirely until
// there's something to show so the header stays clean.
const TOAST_MS = 6000;
const POLL_MS = 15000;

function NotificationsBell({ token }) {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all"); // all | unread
  const [toasts, setToasts] = useState([]); // {id, message, expireAt}
  // First load adopts existing history silently — only arrivals AFTER mount
  // toast. Refs mirror open-state so the poll callback stays fresh.
  const seenRef = useRef(null);
  const openRef = useRef(false);
  openRef.current = open;

  async function load() {
    try {
      const d = await api.myNotifications(token);
      setItems(d.items);
      setUnread(d.unread);
      const seen = seenRef.current;
      if (seen === null) {
        seenRef.current = new Set(d.items.map((n) => n.id));
        return;
      }
      const fresh = d.items.filter((n) => !seen.has(n.id));
      if (fresh.length) {
        fresh.forEach((n) => seen.add(n.id));
        // No toast when the panel is open (already visible) or the tab is
        // hidden (the badge covers it) — avoid redundant interruptions.
        if (!openRef.current && !document.hidden) {
          setToasts((list) =>
            [
              ...fresh.map((n) => ({
                id: n.id,
                message: n.message,
                expireAt: Date.now() + TOAST_MS,
              })),
              ...list,
            ].slice(0, 3)
          );
        }
      }
    } catch {
      /* informational only — a failed load just leaves the bell quiet */
    }
  }

  // Prune expired toasts once a second while any are showing.
  useEffect(() => {
    if (!toasts.length) return;
    const t = setInterval(() => {
      const now = Date.now();
      setToasts((list) => list.filter((x) => x.expireAt > now));
    }, 1000);
    return () => clearInterval(t);
  }, [toasts.length]);

  // Opening the panel makes toasts redundant.
  useEffect(() => {
    if (open) setToasts([]);
  }, [open]);

  const visible = filter === "unread"
    ? items.filter((n) => !n.read)
    : items;
  const unreadVisible = visible.filter((n) => !n.read).length;

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    // Instant catch-up when the user comes back to the tab.
    const onFocus = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      try {
        await api.markMyNotificationsRead(token);
        setUnread(0);
        setItems((list) => list.map((n) => ({ ...n, read: true })));
        // Jump to the all view so the cleared badge is visible right away.
        setFilter("all");
      } catch {
        /* ignore */
      }
    }
  }

  if (visible.length === 0 && unread === 0) return null;

  return (
    <>
    <div className="relative">
      <button
        onClick={toggle}
        className="h-8 w-8 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-800 transition-colors"
        title="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-20 w-80 max-w-[85vw] bg-slate-900 border border-slate-800 rounded-lg shadow-xl p-2">
          {visible.length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-3">
              {items.length === 0
                ? "No notifications yet."
                : filter === "unread"
                  ? "All read."
                  : "No notifications."}
            </div>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              <div className="flex items-center justify-between px-2 py-1 border-b border-slate-800/60">
                <span className="text-[10px] uppercase tracking-wide text-slate-500">
                  {unreadVisible}
                </span>
                <button
                  className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                  onClick={() => setFilter(filter === "all" ? "unread" : "all")}
                >
                  {filter === "all" ? "Show unread only" : "Show all"}
                </button>
              </div>
              {visible.map((n) => (
                <div
                  key={n.id}
                  className={
                    "text-xs rounded px-2.5 py-2 border-l-2 border-transparent " +
                    (n.read
                      ? "text-slate-500"
                      : "text-slate-200 bg-slate-950/60 border-l-emerald-500")
                  }
                >
                  <div>{n.message}</div>
                  <div className="text-[10px] text-slate-600 mt-0.5">
                    {new Date(n.createdAt).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
    {/* push-style toasts for new arrivals (outside the header flow) */}
    {toasts.length > 0 && (
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map((t) => (
          <button
            key={t.id}
            onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
            className="block w-72 max-w-[85vw] text-left bg-slate-900 border border-emerald-500/60 rounded-lg shadow-2xl px-4 py-3"
          >
            <div className="flex items-center gap-2 mb-1">
              <Bell className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span className="text-[10px] uppercase tracking-wide text-slate-500">
                Notification
              </span>
            </div>
            <div className="text-sm text-slate-100">{t.message}</div>
          </button>
        ))}
      </div>
    )}
    </>
  );
}

// ---------------- MY EARNINGS ----------------
// Driver-facing summary of what they've earned (their fee % of each completed
// delivery), what's been paid out, and the outstanding balance. Collapsible so
// it stays out of the way during a route.
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

function EarningsCard({ token }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState({ from: "", to: "" });

  // Reload whenever the selected range changes — same completed-at window the
  // admin payouts report uses. Admins can hide this view entirely.
  useEffect(() => {
    let cancelled = false;
    api
      .myEarnings(token, { from: range.from || undefined, to: range.to || undefined })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        /* Earnings are informational — a failed load just hides the card. */
      });
    return () => {
      cancelled = true;
    };
  }, [token, range.from, range.to]);

  if (!data?.linked) return null;

  const t = data.totals;
  const rangeActive = range.from || range.to;
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg mb-6">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <Wallet className="h-4 w-4 text-emerald-400 shrink-0" />
        <span className="text-sm font-medium text-slate-200" style={fontHead}>
          My earnings
        </span>
        <span className="ml-auto text-sm text-slate-300">{money(t.outstanding)}</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-600">owed</span>
        <ChevronDown
          className={
            "h-4 w-4 text-slate-500 transition-transform " + (open ? "rotate-180" : "")
          }
        />
      </button>
      {open && (
        <div className="px-4 pb-4">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">
              Completed
            </span>
            <input
              type="date"
              className={inputClass + " !w-auto px-2 py-1 text-xs"}
              value={range.from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              aria-label="Completed from"
            />
            <span className="text-slate-600 text-xs">to</span>
            <input
              type="date"
              className={inputClass + " !w-auto px-2 py-1 text-xs"}
              value={range.to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              aria-label="Completed to"
            />
            {rangeActive && (
              <button
                className={btnGhost + " px-2 py-1 text-xs"}
                onClick={() => setRange({ from: "", to: "" })}
              >
                Clear
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Earned</div>
              <div className="text-sm font-medium text-slate-200">{money(t.earned)}</div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Paid out</div>
              <div className="text-sm font-medium text-slate-200">{money(t.paid)}</div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Owed</div>
              <div className="text-sm font-medium text-emerald-400">{money(t.outstanding)}</div>
            </div>
          </div>
          {data.orders.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto mb-2">
              {data.orders.slice(0, 20).map((o) => (
                <div
                  key={o.orderId}
                  className="flex items-center justify-between gap-2 text-xs bg-slate-950/60 border border-slate-800/60 rounded px-2.5 py-1.5"
                >
                  <span className="font-mono text-slate-500">{o.orderId}</span>
                  <span className="text-slate-400 truncate">{o.customerName}</span>
                  <span className="text-slate-300 shrink-0">{money(o.earned)}</span>
                </div>
              ))}
              {data.orders.length > 20 && (
                <div className="text-[11px] text-slate-600 text-center pt-1">
                  + {data.orders.length - 20} more
                </div>
              )}
            </div>
          )}
          {data.payouts.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500 mt-2 mb-1">
                Recent payouts
              </div>
              {data.payouts.slice(0, 5).map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-2 text-xs text-slate-400 py-1 border-t border-slate-800/60"
                >
                  <span>
                    {money(p.amount)}
                    <span className="ml-2 text-[10px] uppercase text-slate-600">{p.mode}</span>
                    {p.note ? <span className="ml-2 text-slate-600">{p.note}</span> : null}
                  </span>
                  <span className="text-[11px] text-slate-600">
                    {new Date(p.paidAt).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
