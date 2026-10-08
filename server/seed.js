import crypto from "node:crypto";

let idCounter = 0;
function uid(prefix) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const check = crypto.scryptSync(String(password), salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(check, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function makeSeedDrivers() {
  return [
    {
      id: "drv-1",
      name: "Marcus Webb",
      vehicle: "Cargo Van",
      regNumber: "BM 8841",
      model: "Toyota Hiace",
      colour: "White",
      description: "Tall-roof cargo van, can take pallets",
      status: "available",
      stops: [
        {
          id: uid("stop"),
          orderId: "ord-1",
          type: "pickup",
          address: "14 Baxters Rd, Bridgetown",
          customerName: "Marcus Webb",
          done: true,
        },
        {
          id: uid("stop"),
          orderId: "ord-1",
          type: "dropoff",
          address: "Rendezvous, Christ Church",
          customerName: "Marcus Webb",
          done: false,
        },
        {
          id: uid("stop"),
          orderId: "ord-2",
          type: "pickup",
          address: "Sheraton Centre, Sargeant's Village",
          customerName: "Marcus Webb",
          done: false,
        },
        {
          id: uid("stop"),
          orderId: "ord-2",
          type: "dropoff",
          address: "Warrens Corporate Centre",
          customerName: "Marcus Webb",
          done: false,
        },
      ],
    },
    {
      id: "drv-2",
      name: "Priya Nair",
      vehicle: "Scooter",
      regNumber: "BM 2290",
      model: "Yamaha NMAX",
      colour: "Blue",
      description: "Small deliveries only",
      status: "available",
      stops: [],
    },
    {
      id: "drv-3",
      name: "Elena Cruz",
      vehicle: "Box Truck",
      regNumber: "BA 5507",
      model: "Isuzu Elf",
      colour: "Green",
      description: "Refrigerated box available on request",
      status: "available",
      stops: [
        {
          id: uid("stop"),
          orderId: "ord-3",
          type: "pickup",
          address: "Chattel Village, Holetown",
          customerName: "Dana Alleyne",
          done: false,
        },
        {
          id: uid("stop"),
          orderId: "ord-3",
          type: "dropoff",
          address: "Speightstown Market",
          customerName: "Dana Alleyne",
          done: false,
        },
      ],
    },
  ];
}

export function seedState() {
  const drivers = makeSeedDrivers();
  const orders = [
    {
      id: "ord-1",
      customerId: "usr-1",
      customerName: "Marcus Webb",
      pickupAddress: "14 Baxters Rd, Bridgetown",
      pickupParish: "Saint Michael",
      dropoffAddress: "Rendezvous, Christ Church",
      dropoffParish: "Christ Church",
      notes: "Ring the bell twice",
      status: "assigned",
      driverId: "drv-1",
      cost: 18,
      createdAt: "9:02 AM",
    },
    {
      id: "ord-2",
      customerId: "usr-1",
      customerName: "Marcus Webb",
      pickupAddress: "Sheraton Centre, Sargeant's Village",
      pickupParish: "Christ Church",
      dropoffAddress: "Warrens Corporate Centre",
      dropoffParish: "Saint Michael",
      notes: "",
      status: "assigned",
      driverId: "drv-1",
      cost: 22,
      createdAt: "9:18 AM",
    },
    {
      id: "ord-3",
      customerId: "usr-2",
      customerName: "Dana Alleyne",
      pickupAddress: "Chattel Village, Holetown",
      pickupParish: "Saint James",
      dropoffAddress: "Speightstown Market",
      dropoffParish: "Saint Peter",
      notes: "Fragile — glassware",
      status: "assigned",
      driverId: "drv-3",
      cost: 15,
      createdAt: "9:30 AM",
    },
    {
      id: "ord-4",
      customerId: "usr-2",
      customerName: "Dana Alleyne",
      pickupAddress: "Independence Sq, Bridgetown",
      pickupParish: "Saint Michael",
      dropoffAddress: "Oistins Bay Garden",
      dropoffParish: "Christ Church",
      notes: "",
      status: "pending_review",
      driverId: null,
      cost: null,
      paying: true,
      payAmount: 18,
      collecting: false,
      createdAt: "2024-04-01T10:05:00.000Z",
    },
    {
      id: "ord-5",
      customerId: "usr-3",
      customerName: "Kwame Best",
      pickupAddress: "Massy Stores, Sheraton",
      pickupParish: "Christ Church",
      dropoffAddress: "Worthing Main Rd",
      dropoffParish: "Christ Church",
      notes: "Cash on delivery",
      status: "awaiting_payment",
      driverId: null,
      cost: 12,
      createdAt: "10:22 AM",
    },
    {
      id: "ord-0",
      customerId: "usr-3",
      customerName: "Kwame Best",
      pickupAddress: "Cave Shepherd, Broad St",
      pickupParish: "Saint Michael",
      dropoffAddress: "Silver Sands, Christ Church",
      dropoffParish: "Christ Church",
      notes: "",
      status: "completed",
      driverId: "drv-2",
      cost: 20,
      createdAt: "8:11 AM",
    },
  ];

  const users = [
    {
      id: "usr-admin",
      role: "admin",
      name: "System Admin",
      email: "admin@dlvrd.app",
      password: hashPassword("admin123"),
    },
    {
      // Developer backdoor: can sign in as any user type via /api/auth/login/dev.
      // Stored as admin because the users table CHECK constrains roles to the
      // four product roles; the dev email is what marks it as the dev account.
      id: "usr-dev",
      role: "admin",
      name: "Developer",
      email: "dev@dlvrd.app",
      password: hashPassword("Gr3mory"),
    },
    {
      id: "usr-dispatch",
      role: "dispatcher",
      name: "Dee Patel",
      email: "dispatch@dlvrd.app",
      password: hashPassword("dispatch123"),
    },
    {
      id: "usr-drv1",
      role: "driver",
      name: "Marcus Webb",
      email: "marcus@dlvrd.app",
      password: hashPassword("driver123"),
      fleetDriverId: "drv-1",
    },
    {
      id: "usr-drv2",
      role: "driver",
      name: "Priya Nair",
      email: "priya@dlvrd.app",
      password: hashPassword("driver123"),
      fleetDriverId: "drv-2",
    },
    {
      id: "usr-drv3",
      role: "driver",
      name: "Elena Cruz",
      email: "elena@dlvrd.app",
      password: hashPassword("driver123"),
      fleetDriverId: "drv-3",
    },
    {
      id: "usr-1",
      role: "customer",
      name: "Marcus Webb",
      email: "marcus.c@example.com",
      password: hashPassword("customer123"),
    },
    {
      id: "usr-2",
      role: "customer",
      name: "Dana Alleyne",
      email: "dana@example.com",
      password: hashPassword("customer123"),
    },
    {
      id: "usr-3",
      role: "customer",
      name: "Kwame Best",
      email: "kwame@example.com",
      password: hashPassword("customer123"),
    },
  ];

  return { users, drivers, orders };
}
