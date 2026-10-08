# DLVRD — Dispatch Console

A full-stack React app: a dispatch console
where customers request pickups, dispatchers price and assign orders, drivers complete
stops, and an admin manages the whole operation.

## Stack

- **Frontend:** React 18 + Vite + Tailwind CSS v4 + lucide-react
- **Backend:** Express (REST API), password hashing with `crypto.scrypt`, **signed JWT
  auth** (`jsonwebtoken`, HS256 — secret from `JWT_SECRET` or a generated
  `server/.jwt-secret` file), **SQLite persistence** (`server/dlvrd.db` via
  `better-sqlite3`)
- **Migrations:** schema changes are applied automatically on startup by versioned
  migrations tracked in SQLite's `PRAGMA user_version` — future changes never require
  deleting the database. On a brand-new database the app imports a legacy
  `server/data.json` (the pre-SQLite format) if one exists, otherwise it seeds demo
  data. To reset to a clean demo state, delete `server/dlvrd.db` **and** any
  `server/data.json`. Upgrading from a pre-rebrand install (`waypoint.db`) is
  automatic: the file is renamed to `dlvrd.db` on first start and the seeded
  `@waypoint.app` logins are moved to `@dlvrd.app` addresses by a versioned
  migration

## Getting started

```bash
npm install
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:4000

Production build (the server also serves the built frontend from `dist/`):

```bash
npm run build
npm start   # then open http://localhost:4000
```

## Demo accounts

| Role       | Email                 | Password      |
| ---------- | --------------------- | ------------- |
| Customer   | dana@example.com      | customer123   |
| Dispatcher | dispatch@dlvrd.app    | dispatch123   |
| Driver     | marcus@dlvrd.app      | driver123     |
| Admin      | admin@dlvrd.app       | admin123      |

Databases created before the DLVRD rebrand are migrated in place: the old
`server/waypoint.db` file is renamed automatically, and seeded accounts with
`@waypoint.app` emails are moved to their `@dlvrd.app` equivalents (existing
customer-registered accounts are never touched).

The login screen has a "Use demo credentials" button for each role. Customers can also
self-register from the login screen.

## Features

- **Customer (users):** register/login, request pickups with pickup/drop-off **parish**,
  pay priced orders, cancel before payment, track order status (including cancellations).
- **Dispatcher:** price new requests, drag-and-drop orders onto drivers, reorder/move
  stops between drivers, unassign orders, mark stops complete, add fleet drivers (no
  public driver signup), edit driver/vehicle details (registration number, model,
  colour, description), cancel **any** job at any time, and resolve driver
  cancellation requests by approving or reassigning them. Dispatchers can also attach
  **notes to individual pickup/drop-off stops** on the board (gate codes, call-ahead
  instructions, package care, etc.) — the driver sees them on the relevant stop and
  they survive moves and reassignments. Notes can be added **before assignment too**:
  needs-pricing cards and unassigned orders carry separate pickup/drop-off notes that
  become the stop notes once the job is dropped onto a driver. An **audit trail**
  records every dispatch/driver note add, change, and removal (who, when, before →
  after), shown inside the note editors on the board. Dispatchers also get a
  **driver-account change log** (scroll icon by the bell): admin actions on driver
  logins — creation, edits, password resets, deletes, fleet-driver links — appear
  there so dispatchers know who changed what on the accounts that drive their routes.
- **Driver:** sees only their own route — current stop first, queued stops locked until
  completed. Can mark themselves available/off duty, edit their own vehicle details,
  tap **"On my way"** when starting a stop (the dispatcher is notified), and request
  cancellation of a job (the dispatcher must approve or reassign it). Dispatcher
  **notes on each stop** are shown so drivers know what to do when they arrive, and
  drivers can **reply with their own note** at a stop (gate locked, package left with
  security, etc.) — the dispatcher sees it on the board and gets a notification.
  **Every pickup requires a proof-of-pickup photo**: the driver attaches a
  camera/file photo to the pickup stop (stored in `server/uploads/`), and the stop
  cannot be marked complete until one is attached.
- **Dispatcher notifications:** a bell feed (polled every few seconds) shows driver
  "on my way" updates and cancellation requests, and the board refreshes automatically.
- **Admin:** overview stats (orders by status, revenue, users, active drivers), full
  user management (create, change role, delete, edit name/email, **reset a password
  without the current one**, and link a driver-role account to a fleet driver — each
  fleet driver can back at most one login), fleet driver management with vehicle
  details, and control over every order (price, assign, cancel, approve/reassign
  cancellation requests). An **account audit log** records every admin create/edit/
  delete/password-reset — who changed what, and when (password values are never
  stored). Admins can also switch to the full dispatch console from the top bar.

## Login APIs (one per user type)

All login endpoints accept `{ "email", "password" }` and return
`{ "token", "user" }`. Use the token as `Authorization: Bearer <token>`.

| Endpoint                       | User type |
| ------------------------------ | --------- |
| `POST /api/auth/login/customer` | customers |
| `POST /api/auth/login/dispatcher` | dispatchers |
| `POST /api/auth/login/driver`   | drivers |
| `POST /api/auth/login/admin`    | admins |

### Other endpoints

| Method | Path                          | Roles                       | Description |
| ------ | ----------------------------- | --------------------------- | ----------- |
| POST   | `/api/auth/register`          | public                      | Create a customer account |
| GET    | `/api/auth/me`                | any                         | Current user from token |
| GET    | `/api/orders`                 | any (role-scoped)           | List orders |
| POST   | `/api/orders`                 | customer                    | Request a pickup |
| POST   | `/api/orders/:id/cancel`      | customer (owner, pre-payment), dispatcher, admin | Cancel (kept as `cancelled`) |
| POST   | `/api/orders/:id/request-cancel` | driver (assigned)         | Driver asks to cancel → `cancel_requested` |
| POST   | `/api/orders/:id/approve-cancel` | dispatcher, admin         | Approve a driver's cancellation request |
| POST   | `/api/orders/:id/reassign`    | dispatcher, admin           | Reassign an order to another driver |
| POST   | `/api/orders/:id/price`       | dispatcher, admin           | Set cost → awaiting_payment |
| POST   | `/api/orders/:id/pay`         | customer (owner)            | Pay → unassigned |
| POST   | `/api/orders/:id/assign`      | dispatcher, admin           | Assign driver, create stops |
| POST   | `/api/orders/:id/unassign`    | dispatcher, admin           | Return to unassigned pool |
| POST   | `/api/orders/:id/notes`       | dispatcher, admin           | Set pickup/drop-off driver notes (empty clears; synced to assigned stops) |
| POST   | `/api/stops/:id/move`         | dispatcher, admin           | Move/reorder a stop |
| POST   | `/api/stops/:id/toggle`       | dispatcher, admin, driver   | Complete/undo a stop (a driver must attach a pickup photo before completing a pickup) |
| POST   | `/api/stops/:id/photo`        | dispatcher, admin, driver (assigned) | Attach/replace a proof-of-pickup photo (raw image body, JPEG/PNG/WebP/GIF, ≤ 8 MB) |
| POST   | `/api/stops/:id/notes`        | dispatcher, admin           | Set/clear the note on a pickup/drop-off stop (empty value clears it) |
| POST   | `/api/stops/:id/driver-note`  | dispatcher, admin, driver (assigned) | Driver adds/replies at a stop (staff can clear); empty clears — notifies dispatcher |
| GET    | `/api/note-history`           | dispatcher, admin           | Audit trail of note changes (`?stopId=` / `?orderId=`) |
| POST   | `/api/stops/:id/enroute`      | dispatcher, admin, driver   | "On my way" → notifies dispatcher |
| GET    | `/api/drivers`                | any                         | List fleet drivers |
| POST   | `/api/drivers`                | dispatcher, admin           | Add a fleet driver (name, vehicle, reg/model/colour/description) |
| PATCH  | `/api/drivers/:id`            | dispatcher, admin, driver (self) | Update vehicle/registration details |
| POST   | `/api/drivers/:id/availability` | dispatcher, admin, driver (self) | Toggle available / off duty |
| GET    | `/api/notifications`          | dispatcher, admin           | Driver updates feed (unread count) |
| POST   | `/api/notifications/read`     | dispatcher, admin           | Mark all notifications read |
| GET    | `/api/admin/stats`            | admin                       | Overview statistics |
| GET    | `/api/admin/users`            | admin                       | List all user accounts |
| POST   | `/api/admin/users`            | admin                       | Create a user account |
| PATCH  | `/api/admin/users/:id`        | admin                       | Update role/name/email/password/fleetDriverId |
| DELETE | `/api/admin/users/:id`        | admin                       | Delete a user account |
| POST   | `/api/admin/users/:id/reset-password` | admin             | Reset password without the current one |
| GET    | `/api/admin/user-events`      | admin                       | Full audit log of account changes |
| GET    | `/api/driver-account-events`  | dispatcher, admin           | Audit log filtered to driver accounts |

## Project structure

```
server/index.js      Express API + JWT auth
server/db.js         SQLite migrations, data access, legacy data.json import
server/seed.js       Seed data and password helpers
server/dlvrd.db      SQLite database (auto-created; gitignored)
server/uploads/      Proof-of-pickup photos (auto-created; gitignored)
server/.jwt-secret   JWT signing key, auto-generated (gitignored) unless JWT_SECRET is set
server/data.json     Optional legacy data file, imported into SQLite on first run
src/App.jsx          Session handling, top bar, role routing
src/api.js           API client
src/components.jsx   Shared UI (badges, cards, styles)
src/views/           Login, Customer, Dispatcher, Driver, Admin views
```