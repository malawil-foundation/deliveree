import React, { useEffect } from "react";
import { Package, MapPin, Truck, X } from "lucide-react";

export const fontHead = {
  fontFamily: "'Space Grotesk', ui-sans-serif, system-ui",
};
export const fontBody = {
  fontFamily: "'Inter', ui-sans-serif, system-ui",
};
export const fontMono = {
  fontFamily: "ui-monospace, 'SFMono-Regular', Menlo, monospace",
};
export const inputClass =
  "w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500";
export const btnPrimary =
  "bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-medium rounded-md py-2 text-sm transition-colors disabled:bg-slate-800 disabled:text-slate-500";
export const btnGhost =
  "border border-slate-800 hover:border-slate-700 rounded-md py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors";

// Parishes of Barbados — location info attached to every pickup / drop-off
export const PARISHES = [
  "Christ Church",
  "Saint Andrew",
  "Saint George",
  "Saint James",
  "Saint John",
  "Saint Joseph",
  "Saint Lucy",
  "Saint Michael",
  "Saint Peter",
  "Saint Philip",
  "Saint Thomas",
];

export function formatLoc(address, parish) {
  return parish ? `${address}, ${parish}` : address;
}

export function fmtTime(val) {
  if (!val) return "";
  try {
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) {
      return String(val);
    }
    const now = new Date();
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();

    const timeStr = d.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });

    if (isToday) {
      return timeStr;
    }
    const dateStr = d.toLocaleDateString([], {
      month: "short",
      day: "numeric",
    });
    return `${dateStr}, ${timeStr}`;
  } catch {
    return String(val || "");
  }
}

// ================= STATUS BADGE =================
export function StatusBadge({ status }) {
  const map = {
    pending_review: "bg-emerald-950 text-emerald-300 border-emerald-900",
    awaiting_payment: "bg-emerald-950 text-emerald-300 border-emerald-800",
    unassigned: "bg-slate-800 text-slate-300 border-slate-700",
    assigned: "bg-blue-950 text-blue-300 border-blue-900",
    cancel_requested: "bg-orange-950 text-orange-300 border-orange-900",
    cancelled: "bg-red-950 text-red-300 border-red-900",
    completed: "bg-emerald-950 text-emerald-300 border-emerald-900",
    available: "bg-emerald-950 text-emerald-300 border-emerald-900",
    "on-route": "bg-emerald-950 text-emerald-300 border-emerald-800",
    "off-duty": "bg-slate-800 text-slate-400 border-slate-700",
  };
  const labelMap = {
    pending_review: "Needs pricing",
    awaiting_payment: "Awaiting payment",
    unassigned: "Unassigned",
    assigned: "Assigned",
    cancel_requested: "Cancel requested",
    cancelled: "Cancelled",
    completed: "Completed",
    available: "Available",
    "on-route": "On route",
    "off-duty": "Off duty",
  };
  return (
    <span
      className={
        "inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium " +
        (map[status] || "bg-slate-800 text-slate-300 border-slate-700")
      }
    >
      {labelMap[status] || status}
    </span>
  );
}

// ================= PHOTO LIGHTBOX =================
// Full-screen overlay for viewing a photo (proof-of-pickup shots, etc.)
export function Lightbox({ src, alt = "Photo", onClose }) {
  useEffect(() => {
    if (!src) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [src, onClose]);

  if (!src) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        onClick={onClose}
        title="Close (Esc)"
        className="absolute top-4 right-4 h-9 w-9 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors"
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
      />
    </div>
  );
}

// ================= STAT BLOCK =================
export function StatBlock({ label, value }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 min-w-[160px]">
      <div className="text-2xl font-semibold" style={fontHead}>
        {value}
      </div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

// ================= ORDER CARD =================
export function OrderCard({ order, driver, onCancel, onPay, onPrice }) {
  const statusNote = {
    pending_review: "A dispatcher is pricing this delivery.",
    awaiting_payment: "Priced — pay to send this to dispatch.",
    unassigned: "Paid — awaiting driver assignment.",
    cancel_requested: "Your driver asked to cancel — a dispatcher is deciding.",
    cancelled: "This order was cancelled.",            completed: order.completedAt
      ? `Delivered at ${fmtTime(order.completedAt)}. Thanks for using Deliveree.`
      : "Delivered. Thanks for using Deliveree.",
  }[order.status];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span style={fontMono}>{order.id}</span>
          <span>&middot;</span>
          <span>{fmtTime(order.createdAt)}</span>
        </div>
        <StatusBadge status={order.status} />
      </div>

      <div className="space-y-1.5 mb-3">
        <div className="flex items-start gap-2 text-sm">
          <Package className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
          <span>{formatLoc(order.pickupAddress, order.pickupParish)}</span>
        </div>
        <div className="flex items-start gap-2 text-sm">
          <MapPin className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
          <span>{formatLoc(order.dropoffAddress, order.dropoffParish)}</span>
        </div>
      </div>

      {order.notes && (
        <p className="text-xs text-slate-500 mb-3">"{order.notes}"</p>
      )}

      {order.status === "awaiting_payment" && (
        <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/30 rounded-md px-3 py-2 mb-3">
          <div>
            <div className="text-xs text-slate-400">Delivery cost</div>
            <div className="text-lg font-semibold" style={fontHead}>
              ${(order.cost ?? 0).toFixed(2)}
            </div>
          </div>
          {onPay && (
            <button
              onClick={onPay}
              className="text-xs bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-medium rounded-md px-3 py-1.5 transition-colors"
            >
              Pay ${(order.cost ?? 0).toFixed(2)}
            </button>
          )}
        </div>
      )}

      {order.status === "pending_review" && onPrice && (
        <PricingInline order={order} onPrice={onPrice} />
      )}

      {order.cost != null && order.status !== "awaiting_payment" && (
        <div className="text-xs text-slate-400 mb-3">
          Delivery cost:{" "}
          <span className="text-slate-200 font-medium">
            ${order.cost.toFixed(2)}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">
          {driver ? (
            <span className="flex items-center gap-1">
              <Truck className="h-3.5 w-3.5" /> {driver.name}
            </span>
          ) : (
            statusNote || "Awaiting driver assignment"
          )}
        </div>
        {onCancel && (
          <button
            onClick={onCancel}
            className="text-xs text-red-400 hover:text-red-300"
          >
            Cancel order
          </button>
        )}
      </div>
    </div>
  );
}

// Inline price editor for the customer-facing "needs pricing" state.
function PricingInline({ order, onPrice }) {
  const [cost, setCost] = React.useState("");
  const value = parseFloat(cost);
  const valid = cost !== "" && !Number.isNaN(value) && value > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onPrice(order.id, value);
        setCost("");
      }}
      className="flex items-center gap-2 mb-3 bg-emerald-950/20 border border-emerald-900/50 rounded-md px-3 py-2"
    >
      <span className="text-xs text-slate-400">Price this delivery:</span>
      <input
        value={cost}
        onChange={(e) => setCost(e.target.value)}
        type="number"
        min="0"
        step="0.01"
        placeholder="0.00"
        className="w-24 bg-slate-950 border border-slate-800 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
      />
      <button
        type="submit"
        disabled={!valid}
        className="text-xs bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-medium rounded-md px-3 py-1.5 transition-colors"
      >
        Approve
      </button>
    </form>
  );
}

// ================= SPINNER =================
export function Spinner({ className = "h-5 w-5" }) {
  return (
    <span
      className={
        "inline-block animate-spin rounded-full border-2 border-current border-t-transparent align-middle " +
        className
      }
    />
  );
}

// ================= PRELOADER =================
// Deliveree brand-kit preloader: logo mark + animated truck + route fill +
// percent/status, then the Deliveree wordmark with "e" in accent.
// The `done` prop controls fade-out (set by App.jsx when loading finishes).
export function Preloader({ label = "en route", done = false }) {
  const truckRef = React.useRef(null);
  const fillRef = React.useRef(null);
  const pctRef = React.useRef(null);
  const statusRef = React.useRef(null);
  const checkRef = React.useRef(null);
  const stageRef = React.useRef(null);
  const rafRef = React.useRef(null);
  const t0Ref = React.useRef(0);
  const finishedRef = React.useRef(false);
  const DUR = 2600;

  // Expose a no-op DLV stub so App.jsx's DLV.done() / DLV.restart() calls
  // don't throw if the Preloader unmounts between renders. Real orchestration
  // is done via the `done` prop (set by App.jsx state).
  React.useEffect(() => {
    if (!window.DLV) {
      window.DLV = { done() {}, restart() {} };
    }
    return () => {};
  }, []);

  React.useEffect(() => {
    if (done) {
      finishedRef.current = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (truckRef.current && stageRef.current) {
        const max = stageRef.current.clientWidth - truckRef.current.offsetWidth - 8;
        truckRef.current.style.transform = `translateX(${4 + max}px)`;
      }
      if (fillRef.current) fillRef.current.style.width = "100%";
      if (pctRef.current) pctRef.current.textContent = "100%";
      if (statusRef.current) {
        statusRef.current.textContent = "delivered";
        statusRef.current.style.color = "var(--dlv-accent)";
      }
      if (checkRef.current) {
        checkRef.current.style.opacity = "1";
        checkRef.current.style.transform = "scale(1)";
      }
    } else {
      finishedRef.current = false;
      t0Ref.current = performance.now();
      const frame = (now) => {
        if (finishedRef.current || done) return;
        const raw = Math.min((now - t0Ref.current) / DUR, 1);
        const p = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
        if (truckRef.current && stageRef.current) {
          const max = stageRef.current.clientWidth - truckRef.current.offsetWidth - 8;
          truckRef.current.style.transform = `translateX(${(4 + p * max)}px)`;
        }
        if (fillRef.current) fillRef.current.style.width = `${p * 100}%`;
        if (pctRef.current) pctRef.current.textContent = `${Math.round(p * 100)}%`;
        if (statusRef.current) statusRef.current.textContent = label;
        rafRef.current = requestAnimationFrame(frame);
      };
      rafRef.current = requestAnimationFrame(frame);
    }
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [done, label]);

  return (
    <div className={`dlv-overlay${done ? " dlv-done" : ""}`} role="status" aria-label="Loading">
      <div className="dlv-card">
        <svg width="56" height="56" style={{ color: "var(--dlv-ink)" }} aria-hidden="true">
          <use href="#dlv-mark" />
        </svg>

        <div className="dlv-stage" ref={stageRef}>
          <div className="dlv-truck" ref={truckRef}>
            <svg width="96" viewBox="0 0 128 72" style={{ display: "block", color: "var(--dlv-ink)" }} aria-hidden="true">
              <use href="#dlv-truck" />
            </svg>
          </div>
          <div className="dlv-route"><i ref={fillRef} /></div>
          <div className="dlv-check" ref={checkRef}>
            <svg width="26" height="26" viewBox="0 0 28 28" aria-hidden="true">
              <circle cx="14" cy="14" r="13" fill="var(--dlv-accent)" />
              <path d="M8.5 14.5l4 4 7-8" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        <div className="dlv-meta">
          <span className="dlv-pct" ref={pctRef}>0%</span>
          <span className="dlv-status" ref={statusRef}>{label}</span>
        </div>

        <div className="dlv-wordmark">
          Delive<em>ree</em>
        </div>
      </div>
    </div>
  );
}

// ================= MODAL =================
// Centered dialog with backdrop; closes on backdrop click or Escape. Used for
// the dispatcher's Add order / Add driver forms so they are always one click
// away instead of buried at the bottom of a column.
export function Modal({ open, title, onClose, children, wide }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <div
        className={
          "relative bg-slate-900 border border-slate-800 rounded-xl shadow-2xl w-full modal-pop " +
          (wide ? "max-w-2xl" : "max-w-md")
        }
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <h3 className="text-sm font-semibold text-slate-200" style={fontHead}>
            {title}
          </h3>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}