import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb, query } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, "..", "data", "config.json");

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const getCorsOrigin = (origin) => {
  if (!origin) return "*";
  if (allowedOrigins.includes("*")) return "*";
  if (allowedOrigins.includes(origin)) return origin;
  return null;
};

const sendJson = (res, statusCode, payload, origin = "*") => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  res.writeHead(statusCode, { "Content-Type": "application/json", ...corsHeaders });
  res.end(JSON.stringify(payload));
};

const normalizeText = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, "");
const readConfig = async () => JSON.parse(await fs.readFile(configPath, "utf8"));
const getISTDate = (timestamp = Date.now()) => new Date(timestamp).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const toISTDateTime = (timestamp) => {
  if (!timestamp) return null;
  return new Date(Number(timestamp)).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
};

const haversineMeters = (lat1, lon1, lat2, lon2) => {
  const toRad = (v) => (v * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const parseBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });

const mapAttendance = (row) => ({
  date: row.attendance_date,
  checkInAt: toISTDateTime(row.check_in_at),
  checkOutAt: toISTDateTime(row.check_out_at),
  totalHours: Number(row.total_hours),
  status: row.status,
});

const server = http.createServer(async (req, res) => {
  const requestOrigin = req.headers.origin;
  const corsOrigin = getCorsOrigin(requestOrigin);

  if (!corsOrigin) {
    sendJson(res, 403, { message: "Origin is not allowed by CORS policy." }, "*");
    return;
  }

  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": corsOrigin,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    const url = new URL(req.url, "http://localhost");

    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, { ok: true, message: "Attendance backend is running" }, corsOrigin);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/config") {
      sendJson(res, 200, await readConfig(), corsOrigin);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      const body = await parseBody(req);
      const rawInput = String(body.employeeId || "").trim();
      if (!rawInput) return sendJson(res, 400, { message: "Employee ID is required." }, corsOrigin);

      const dbRes = await query("SELECT id, name, department FROM employees");
      const employee = dbRes.rows.find((item) => {
        const idMatch = normalizeText(item.id) === normalizeText(rawInput);
        const nameMatch = normalizeText(item.name) === normalizeText(rawInput);
        return idMatch || nameMatch;
      });

      if (!employee) return sendJson(res, 404, { message: "Employee not found." }, corsOrigin);
      sendJson(res, 200, { employee }, corsOrigin);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/attendance/today") {
      const employeeId = String(url.searchParams.get("employeeId") || "").trim().toUpperCase();
      if (!employeeId) return sendJson(res, 400, { message: "employeeId is required." }, corsOrigin);

      const today = getISTDate();
      const dbRes = await query(
        `SELECT attendance_date, check_in_at, check_out_at, total_hours, status
         FROM attendance
         WHERE employee_id = $1 AND attendance_date = $2`,
        [employeeId, today]
      );

      sendJson(res, 200, { today, record: dbRes.rows[0] ? mapAttendance(dbRes.rows[0]) : null }, corsOrigin);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/attendance/history") {
      const employeeId = String(url.searchParams.get("employeeId") || "").trim().toUpperCase();
      if (!employeeId) return sendJson(res, 400, { message: "employeeId is required." }, corsOrigin);

      const dbRes = await query(
        `SELECT attendance_date, check_in_at, check_out_at, total_hours, status
         FROM attendance
         WHERE employee_id = $1
         ORDER BY attendance_date DESC, check_in_at DESC
         LIMIT 20`,
        [employeeId]
      );

      sendJson(res, 200, { records: dbRes.rows.map(mapAttendance) }, corsOrigin);
      return;
    }

    if (req.method === "POST" && (url.pathname === "/api/attendance/check-in" || url.pathname === "/api/attendance/check-out")) {
      const isCheckIn = url.pathname.endsWith("check-in");
      const body = await parseBody(req);
      const employeeId = String(body.employeeId || "").trim().toUpperCase();
      const latitude = body.latitude;
      const longitude = body.longitude;

      if (!employeeId) return sendJson(res, 400, { message: "Employee ID is required." }, corsOrigin);
      if (typeof latitude !== "number" || typeof longitude !== "number") {
        return sendJson(res, 400, { message: "Latitude and longitude are required." }, corsOrigin);
      }

      const empRes = await query("SELECT id FROM employees WHERE id = $1", [employeeId]);
      if (!empRes.rows[0]) return sendJson(res, 404, { message: "Employee not found." }, corsOrigin);

      const config = await readConfig();
      const distance = haversineMeters(latitude, longitude, config.office.latitude, config.office.longitude);
      if (distance > config.office.radiusMeters) {
        return sendJson(
          res,
          403,
          {
            message: `Outside office range. You are ${Math.round(distance)}m away, limit is ${config.office.radiusMeters}m.`,
          },
          corsOrigin
        );
      }

      const now = Date.now();
      const today = getISTDate(now);

      const existingRes = await query(
        `SELECT * FROM attendance WHERE employee_id = $1 AND attendance_date = $2`,
        [employeeId, today]
      );
      const existing = existingRes.rows[0];

      if (isCheckIn) {
        if (existing?.check_in_at) return sendJson(res, 409, { message: "Check-in already marked." }, corsOrigin);

        const insertRes = await query(
          `INSERT INTO attendance (
            employee_id, attendance_date, check_in_at, check_out_at, total_hours, status,
            check_in_latitude, check_in_longitude
          ) VALUES ($1, $2, $3, NULL, 0, 'IN', $4, $5)
          RETURNING attendance_date, check_in_at, check_out_at, total_hours, status`,
          [employeeId, today, now, latitude, longitude]
        );

        sendJson(res, 200, { message: "Check-in marked successfully.", record: mapAttendance(insertRes.rows[0]) }, corsOrigin);
        return;
      }

      if (!existing?.check_in_at) return sendJson(res, 409, { message: "No check-in found for today." }, corsOrigin);
      if (existing.check_out_at) return sendJson(res, 409, { message: "Check-out already marked." }, corsOrigin);

      const totalHours = Number(((now - Number(existing.check_in_at)) / (1000 * 60 * 60)).toFixed(2));
      const updateRes = await query(
        `UPDATE attendance
         SET check_out_at = $1,
             check_out_latitude = $2,
             check_out_longitude = $3,
             total_hours = $4,
             status = 'OUT',
             updated_at = NOW()
         WHERE id = $5
         RETURNING attendance_date, check_in_at, check_out_at, total_hours, status`,
        [now, latitude, longitude, totalHours, existing.id]
      );

      sendJson(res, 200, { message: "Check-out marked successfully.", record: mapAttendance(updateRes.rows[0]) }, corsOrigin);
      return;
    }

    sendJson(res, 404, { message: "Route not found." }, corsOrigin);
  } catch (error) {
    sendJson(res, 500, { message: error.message || "Unexpected server error" }, corsOrigin);
  }
});

const PORT = Number(process.env.PORT || 4000);

initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Attendance backend running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize database:", error);
    process.exit(1);
  });
