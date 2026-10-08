const BASE = "/api";

// fetch rejects with TypeError("Failed to fetch") on network drops — server
// restarts, lost wifi, or a proxy killing the connection. Surface something a
// driver can act on instead of the raw browser error.
function friendlyNetworkError() {
  return new Error(
    "Couldn't reach the server — check your connection and try again. If you're on mobile data, try moving somewhere with a better signal."
  );
}

async function request(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw friendlyNetworkError();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

export const api = {
  // auth — one login endpoint per user type (signed JWT). loginAny lets the
  // plain (non-dev) form authenticate without picking a role first; loginDev is
  // the developer backdoor that can sign in as any role.
  login: (role, email, password) =>
    request(`/auth/login/${role}`, { method: "POST", body: { email, password } }),
  loginAny: (email, password) =>
    request("/auth/login", { method: "POST", body: { email, password } }),
  loginDev: (email, password, role) =>
    request("/auth/login/dev", { method: "POST", body: { email, password, role } }),
  register: (name, email, password) => request("/auth/register", { method: "POST", body: { name, email, password } }),
  me: (token) => request("/auth/me", { token }),
  getDemoAccounts: () => request("/auth/demo-accounts"),

  // orders
  getOrders: (token) => request("/orders", { token }),
  createOrder: (token, order) =>
    request("/orders", { method: "POST", body: order, token }),
  cancelOrder: (token, id) =>
    request(`/orders/${id}/cancel`, { method: "POST", token }),
  requestCancel: (token, id, reason) =>
    request(`/orders/${id}/request-cancel`, { method: "POST", body: { reason }, token }),
  approveCancel: (token, id) =>
    request(`/orders/${id}/approve-cancel`, { method: "POST", token }),
  reassignOrder: (token, id, driverId) =>
    request(`/orders/${id}/reassign`, { method: "POST", body: { driverId }, token }),
  priceOrder: (token, id, pricePayload) =>
    request(`/orders/${id}/price`, { method: "POST", body: pricePayload, token }),
  payOrder: (token, id) =>
    request(`/orders/${id}/pay`, { method: "POST", token }),
  assignOrder: (token, id, driverId) =>
    request(`/orders/${id}/assign`, { method: "POST", body: { driverId }, token }),
  unassignOrder: (token, id) =>
    request(`/orders/${id}/unassign`, { method: "POST", token }),
  setOrderNotes: (token, id, notes) =>
    request(`/orders/${id}/notes`, { method: "POST", body: notes, token }),

  // stops
  moveStop: (token, stopId, fromDriverId, toDriverId, toIndex) =>
    request(`/stops/${stopId}/move`, {
      method: "POST",
      body: { fromDriverId, toDriverId, toIndex },
      token,
    }),
  toggleStop: (token, stopId) =>
    request(`/stops/${stopId}/toggle`, { method: "POST", token }),
  setStopNotes: (token, stopId, notes) =>
    request(`/stops/${stopId}/notes`, { method: "POST", body: { notes }, token }),
  setDriverNote: (token, stopId, notes) =>
    request(`/stops/${stopId}/driver-note`, { method: "POST", body: { notes }, token }),
  // audit trail of note changes (staff)
  noteHistory: (token, { stopId, orderId } = {}) =>
    request(
      `/note-history?${new URLSearchParams(stopId ? { stopId } : { orderId }).toString()}`,
      { token }
    ),
  enrouteStop: (token, stopId) =>
    request(`/stops/${stopId}/enroute`, { method: "POST", token }),
  // proof-of-pickup photo — sends the raw image file as the request body
  uploadStopPhoto: async (token, stopId, file) => {
    let res;
    try {
      res = await fetch(`${BASE}/stops/${stopId}/photo`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: file,
      });
    } catch {
      // Network drop mid-upload (the most common cause on phone data).
      throw friendlyNetworkError();
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Upload failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  },

  // fleet drivers
  getDrivers: (token) => request("/drivers", { token }),
  eligibleDriverUsers: (token) => request("/drivers/eligible-users", { token }),
  addDriver: (token, driver) =>
    request("/drivers", { method: "POST", body: driver, token }),
  updateDriver: (token, id, patch) =>
    request(`/drivers/${id}`, { method: "PATCH", body: patch, token }),
  setAvailability: (token, id, available) =>
    request(`/drivers/${id}/availability`, {
      method: "POST",
      body: { available },
      token,
    }),

  // notifications (dispatcher feed)
  getNotifications: (token) => request("/notifications", { token }),
  markNotificationsRead: (token) =>
    request("/notifications/read", { method: "POST", token }),
  // driver-account change log (dispatcher + admin)
  driverAccountEvents: (token) => request("/driver-account-events", { token }),

  // admin
  admin: {
    stats: (token) => request("/admin/stats", { token }),
    users: (token) => request("/admin/users", { token }),
    createUser: (token, user) =>
      request("/admin/users", { method: "POST", body: user, token }),
    updateUser: (token, id, patch) =>
      request(`/admin/users/${id}`, { method: "PATCH", body: patch, token }),
    deleteUser: (token, id) =>
      request(`/admin/users/${id}`, { method: "DELETE", token }),
    resetPassword: (token, id, password) =>
      request(`/admin/users/${id}/reset-password`, {
        method: "POST",
        body: { password },
        token,
      }),
    userEvents: (token) => request("/admin/user-events", { token }),
    payoutSettings: (token) => request("/admin/payout-settings", { token }),
    setFeePct: (token, feePct) =>
      request("/admin/payout-settings", { method: "POST", body: { feePct }, token }),
    driverEarnings: (token, { driverId, from, to } = {}) =>
      request(
        `/admin/driver-earnings?${
          new URLSearchParams(
            Object.entries({ driverId, from, to }).filter(([, v]) => v)
          ).toString()
        }`,
        { token }
      ),
    payouts: (token, driverId) =>
      request(
        `/admin/payouts${driverId ? `?driverId=${encodeURIComponent(driverId)}` : ""}`,
        { token }
      ),
    recordPayout: (token, payload) =>
      request("/admin/payouts", { method: "POST", body: payload, token }),
    // CSV download of the earnings report — fetch (not <a href>) so the auth
    // header is sent and 401/403 responses surface as errors instead of a
    // downloaded error page.
    driversSummary: (token, { from, to } = {}) =>
      request(
        `/admin/drivers-summary?${
          new URLSearchParams(
            Object.entries({ from, to }).filter(([, v]) => v)
          ).toString()
        }`,
        { token }
      ),
    setShowDriverEarnings: (token, showDriverEarnings) =>
      request("/admin/payout-settings", {
        method: "POST",
        body: { showDriverEarnings },
        token,
      }),
    earningsCsv: async (token, { driverId, from, to } = {}) => {
      let res;
      try {
        res = await fetch(
          `${BASE}/admin/driver-earnings.csv?${
            new URLSearchParams(
              Object.entries({ driverId, from, to }).filter(([, v]) => v)
            ).toString()
          }`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
      } catch {
        throw friendlyNetworkError();
      }
      if (!res.ok) {
        throw new Error(`Export failed (${res.status})`);
      }
      return res.blob();
    },
  },

  // driver — own earnings summary (driver console, optional completed-at range)
  myEarnings: (token, { from, to } = {}) =>
    request(
      `/my-earnings?${
        new URLSearchParams(
          Object.entries({ from, to }).filter(([, v]) => v)
        ).toString()
      }`,
      { token }
    ),
  // driver — own notification feed (payout alerts etc.)
  myNotifications: (token) => request("/my-notifications", { token }),
  markMyNotificationsRead: (token) =>
    request("/my-notifications/read", { method: "POST", token }),
};

export const SESSION_KEY = "dlvrd_session";

// The developer backdoor account. Shared with App.jsx so the header can offer
// a role switcher without logging out and back in.
export const DEV_EMAIL = "dev@dlvrd.app";
export const DEV_PASSWORD = "Gr3mory";
