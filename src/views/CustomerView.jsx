import React, { useState } from "react";
import { Package, MapPin, User } from "lucide-react";
import { fontHead, OrderCard, inputClass, btnPrimary, PARISHES } from "../components.jsx";

export default function CustomerView({
  currentUser,
  orders,
  drivers,
  placeOrder,
  cancelOrder,
  payOrder,
}) {
  const myOrders = orders;

  return (
    <div className="grid lg:grid-cols-5 gap-6">
      <div className="lg:col-span-2">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-9 w-9 rounded-full bg-slate-800 flex items-center justify-center">
            <User className="h-4 w-4 text-slate-300" />
          </div>
          <div>
            <div className="text-sm font-medium">{currentUser.name}</div>
            <div className="text-xs text-slate-500">{currentUser.email}</div>
          </div>
        </div>

        <h2 className="text-lg font-semibold mb-3" style={fontHead}>
          Request a pickup
        </h2>
        <OrderForm onSubmit={placeOrder} />
      </div>

      <div className="lg:col-span-3">
        <h2 className="text-lg font-semibold mb-3" style={fontHead}>
          Your orders
        </h2>
        {myOrders.length === 0 ? (
          <div className="text-slate-500 text-sm border border-dashed border-slate-800 rounded-lg p-6 text-center">
            No orders yet. Request your first pickup on the left.
          </div>
        ) : (
          <div className="space-y-3">
            {myOrders.map((o) => (
              <OrderCard
                key={o.id}
                order={o}
                driver={drivers.find((d) => d.id === o.driverId)}
                onCancel={
                  ["pending_review", "awaiting_payment", "unassigned"].includes(
                    o.status
                  )
                    ? () => cancelOrder(o.id)
                    : null
                }
                onPay={
                  o.status === "awaiting_payment"
                    ? () => payOrder(o.id)
                    : null
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PinInputs({ lat, lng, onLat, onLng, loading, onUseMyLocation }) {
  return (
    <div className="mt-2 space-y-1.5 bg-slate-950 border border-slate-800 rounded-md p-2.5">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Latitude</label>
          <input
            value={lat}
            onChange={(e) => onLat(e.target.value)}
            placeholder="e.g. 17.9945"
            type="number"
            step="any"
            className={inputClass + " text-xs py-1"}
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Longitude</label>
          <input
            value={lng}
            onChange={(e) => onLng(e.target.value)}
            placeholder="e.g. -76.7936"
            type="number"
            step="any"
            className={inputClass + " text-xs py-1"}
          />
        </div>
      </div>
      <button
        type="button"
        onClick={onUseMyLocation}
        disabled={loading}
        className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 disabled:opacity-50 transition-colors"
      >
        <MapPin className="h-3 w-3" />
        {loading ? "Getting location…" : "Use my current location"}
      </button>
    </div>
  );
}

function OrderForm({ onSubmit }) {
  const [pickupAddress, setPickupAddress] = useState("");
  const [pickupParish, setPickupParish] = useState("");
  const [pickupPin, setPickupPin] = useState(false);
  const [pickupLat, setPickupLat] = useState("");
  const [pickupLng, setPickupLng] = useState("");
  const [pickupLocLoading, setPickupLocLoading] = useState(false);

  const [dropoffAddress, setDropoffAddress] = useState("");
  const [dropoffParish, setDropoffParish] = useState("");
  const [dropoffPin, setDropoffPin] = useState(false);
  const [dropoffLat, setDropoffLat] = useState("");
  const [dropoffLng, setDropoffLng] = useState("");
  const [dropoffLocLoading, setDropoffLocLoading] = useState(false);

  const [notes, setNotes] = useState("");

  function useMyLocation(setLat, setLng, setLoading) {
    if (!navigator.geolocation) {
      alert("Your browser does not support geolocation.");
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(String(pos.coords.latitude));
        setLng(String(pos.coords.longitude));
        setLoading(false);
      },
      (err) => {
        alert("Could not get your location: " + err.message);
        setLoading(false);
      }
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!pickupAddress.trim() || !dropoffAddress.trim()) return;
        onSubmit({
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
        setPickupAddress("");
        setPickupParish("");
        setPickupPin(false);
        setPickupLat("");
        setPickupLng("");
        setDropoffAddress("");
        setDropoffParish("");
        setDropoffPin(false);
        setDropoffLat("");
        setDropoffLng("");
        setNotes("");
      }}
      className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4"
    >
      <div>
        <label className="block text-sm text-slate-400 mb-1 flex items-center gap-1.5">
          <Package className="h-3.5 w-3.5 text-blue-400" /> Pickup location
        </label>
        <input
          value={pickupAddress}
          onChange={(e) => setPickupAddress(e.target.value)}
          placeholder="Street address, landmark, business…"
          className={inputClass}
        />
        <select
          value={pickupParish}
          onChange={(e) => setPickupParish(e.target.value)}
          className={inputClass + " mt-2"}
        >
          <option value="">Pickup parish (optional)</option>
          {PARISHES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setPickupPin((v) => !v)}
          className={
            "mt-2 flex items-center gap-1 text-[11px] transition-colors " +
            (pickupPin
              ? "text-emerald-400 hover:text-emerald-300"
              : "text-slate-500 hover:text-slate-300")
          }
        >
          <MapPin className="h-3 w-3" />
          {pickupPin ? "Remove pin" : "Add GPS pin"}
        </button>
        {pickupPin && (
          <PinInputs
            lat={pickupLat}
            lng={pickupLng}
            onLat={setPickupLat}
            onLng={setPickupLng}
            loading={pickupLocLoading}
            onUseMyLocation={() =>
              useMyLocation(setPickupLat, setPickupLng, setPickupLocLoading)
            }
          />
        )}
      </div>
      <div>
        <label className="block text-sm text-slate-400 mb-1 flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-emerald-400" /> Drop-off location
        </label>
        <input
          value={dropoffAddress}
          onChange={(e) => setDropoffAddress(e.target.value)}
          placeholder="Street address, landmark, business…"
          className={inputClass}
        />
        <select
          value={dropoffParish}
          onChange={(e) => setDropoffParish(e.target.value)}
          className={inputClass + " mt-2"}
        >
          <option value="">Drop-off parish (optional)</option>
          {PARISHES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setDropoffPin((v) => !v)}
          className={
            "mt-2 flex items-center gap-1 text-[11px] transition-colors " +
            (dropoffPin
              ? "text-emerald-400 hover:text-emerald-300"
              : "text-slate-500 hover:text-slate-300")
          }
        >
          <MapPin className="h-3 w-3" />
          {dropoffPin ? "Remove pin" : "Add GPS pin"}
        </button>
        {dropoffPin && (
          <PinInputs
            lat={dropoffLat}
            lng={dropoffLng}
            onLat={setDropoffLat}
            onLng={setDropoffLng}
            loading={dropoffLocLoading}
            onUseMyLocation={() =>
              useMyLocation(setDropoffLat, setDropoffLng, setDropoffLocLoading)
            }
          />
        )}
      </div>
      <div>
        <label className="block text-sm text-slate-400 mb-1">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Package size, access instructions, anything the driver should know"
          rows={2}
          className={inputClass + " resize-none"}
        />
      </div>
      <button type="submit" className={btnPrimary + " w-full"}>
        Request pickup
      </button>
    </form>
  );
}