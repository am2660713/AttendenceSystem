import http from "node:http";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb, query } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, "..", "data", "config.json");
const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
const adminSessions = new Map();

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

const corsAllowHeaders = "Content-Type, x-admin-token";

const sendJson = (res, statusCode, payload, origin = "*") => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": corsAllowHeaders,
  };

  res.writeHead(statusCode, { "Content-Type": "application/json", ...corsHeaders });
  res.end(JSON.stringify(payload));
};

const sendCsv = (res, csv, origin = "*", filename = "attendance-export.csv") => {
  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": corsAllowHeaders,
    "Access-Control-Expose-Headers": "Content-Disposition",
  });
  res.end(`\uFEFF${csv}`);
};

const normalizeText = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, "");
const readConfig = async () => JSON.parse(await fs.readFile(configPath, "utf8"));
const getISTDate = (timestamp = Date.now()) => new Date(timestamp).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const getISTMonth = (timestamp = Date.now()) => new Date(timestamp).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7);

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

const parseISTDateTime = (dateString, timeString) => new Date(`${dateString}T${timeString}:00+05:30`).getTime();

const toMinutes = (hhmm) => {
  const [hours, minutes] = String(hhmm || "0:0").split(":").map((part) => Number(part));
  return (hours * 60) + minutes;
};

const padTwo = (value) => String(value).padStart(2, "0");

const getMonthBounds = (month) => {
  const safeMonth = /^\d{4}-\d{2}$/.test(month) ? month : getISTMonth();
  const start = new Date(`${safeMonth}-01T00:00:00+05:30`).getTime();
  const [year, monthPart] = safeMonth.split("-").map(Number);
  const nextMonthStart = monthPart === 12
    ? new Date(`${year + 1}-01-01T00:00:00+05:30`).getTime()
    : new Date(`${year}-${padTwo(monthPart + 1)}-01T00:00:00+05:30`).getTime();
  return { start, end: nextMonthStart, month: safeMonth };
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

const csvCell = (value) => {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const getAdminToken = (req) => String(req.headers["x-admin-token"] || "").trim();

const requireAdminSession = (req, res, origin) => {
  const token = getAdminToken(req);
  const expiresAt = adminSessions.get(token);
  if (!token || !expiresAt || expiresAt <= Date.now()) {
    if (token) adminSessions.delete(token);
    sendJson(res, 401, { message: "Admin authorization required." }, origin);
    return null;
  }
  return token;
};

const mapAttendance = (row, config) => {
  const metrics = config ? buildDailyMetrics(row, config) : null;
  return {
    date: row.attendance_date,
    checkInAt: toISTDateTime(row.check_in_at),
    checkOutAt: toISTDateTime(row.check_out_at),
    totalHours: Number(row.total_hours),
    status: row.status,
    lateByMinutes: metrics?.lateByMinutes || 0,
    overtimeMinutes: metrics?.overtimeMinutes || 0,
    lateMark: metrics?.lateMark || false,
    overtimeHours: metrics?.overtimeHours || 0,
  };
};

const buildDailyMetrics = (row, config) => {
  const shiftStartMinutes = toMinutes(config.shift?.start || "09:30");
  const shiftEndMinutes = toMinutes(config.shift?.end || "18:30");
  const graceMinutes = Number(config.shift?.graceMinutes || 0);
  const lateThreshold = shiftStartMinutes + graceMinutes;
  const lateThresholdTime = `${padTwo(Math.floor(lateThreshold / 60))}:${padTwo(lateThreshold % 60)}`;
  const dayStart = parseISTDateTime(row.attendance_date, "00:00");
  const checkInTime = row.check_in_at ? Number(row.check_in_at) : null;
  const checkOutTime = row.check_out_at ? Number(row.check_out_at) : null;
  const shiftStartTime = parseISTDateTime(row.attendance_date, config.shift?.start || "09:30");
  const shiftEndTime = parseISTDateTime(row.attendance_date, config.shift?.end || "18:30");
  const thresholdTime = parseISTDateTime(row.attendance_date, lateThresholdTime);

  const lateByMinutes = checkInTime && checkInTime > thresholdTime
    ? Math.round((checkInTime - thresholdTime) / 60000)
    : 0;

  const overtimeMinutes = checkOutTime && checkOutTime > shiftEndTime
    ? Math.round((checkOutTime - shiftEndTime) / 60000)
    : 0;

  return {
    dayStart,
    shiftStartTime,
    shiftEndTime,
    lateByMinutes,
    overtimeMinutes,
    lateMark: lateByMinutes > 0,
    overtimeHours: Number((overtimeMinutes / 60).toFixed(2)),
    lateThresholdTime,
  };
};

const defaultEmployees = [
  { id: "EMP001", name: "Aarav Sharma", department: "Sales" },
  { id: "EMP002", name: "Priya Verma", department: "HR" },
  { id: "EMP003", name: "Rohit Singh", department: "Operations" },
];

const ensureDefaultEmployees = async () => {
  const countRes = await query("SELECT COUNT(*)::int AS count FROM employees");
  if (countRes.rows[0].count > 0) return;

  for (const employee of defaultEmployees) {
    await query(
      `INSERT INTO employees (id, name, department)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           department = EXCLUDED.department`,
      [employee.id, employee.name, employee.department]
    );
  }
};

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
        "Access-Control-Allow-Headers": corsAllowHeaders,
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
      const rawInput = String(body.employeeId || "").trim().toUpperCase();
      const deviceToken = String(body.deviceToken || "").trim();
      const deviceLabel = String(body.deviceLabel || "").trim().slice(0, 255);
      if (!rawInput) return sendJson(res, 400, { message: "Employee ID is required." }, corsOrigin);
      if (!deviceToken) return sendJson(res, 400, { message: "Device information is required." }, corsOrigin);

      const dbRes = await query(
        "SELECT id, name, department, device_token, device_label FROM employees WHERE active = true AND id = $1",
        [rawInput]
      );
      const employee = dbRes.rows[0];

      if (!employee) return sendJson(res, 404, { message: "Employee not found." }, corsOrigin);
      if (employee.device_token && employee.device_token !== deviceToken) {
        return sendJson(res, 403, { message: "This employee is locked to another company laptop." }, corsOrigin);
      }

      if (!employee.device_token) {
        await query(
          `UPDATE employees
           SET device_token = $2,
               device_label = $3,
               device_bound_at = NOW()
           WHERE id = $1`,
          [employee.id, deviceToken, deviceLabel || "Approved company laptop"]
        );
      }

      sendJson(
        res,
        200,
        {
          message: employee.device_token
            ? "Company laptop verified. Login successful."
            : "Company laptop approved and login successful.",
          employee: { id: employee.id, name: employee.name, department: employee.department },
        },
        corsOrigin
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/admin/unlock") {
      const body = await parseBody(req);
      const password = String(body.password || "");
      if (!password) {
        sendJson(res, 400, { message: "Password is required." }, corsOrigin);
        return;
      }
      if (password !== adminPassword) {
        sendJson(res, 401, { message: "Invalid admin password." }, corsOrigin);
        return;
      }
      const token = crypto.randomUUID();
      adminSessions.set(token, Date.now() + 8 * 60 * 60 * 1000);
      sendJson(res, 200, { message: "Admin unlocked.", token }, corsOrigin);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/employees") {
      if (!requireAdminSession(req, res, corsOrigin)) return;
      const dbRes = await query(
        "SELECT id, name, department, device_token, device_label, device_bound_at FROM employees WHERE active = true ORDER BY id"
      );
      sendJson(
        res,
        200,
        {
          employees: dbRes.rows.map((employee) => ({
            ...employee,
            deviceBound: Boolean(employee.device_token),
            deviceLabel: employee.device_label || "",
          })),
        },
        corsOrigin
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/employees") {
      if (!requireAdminSession(req, res, corsOrigin)) return;
      const body = await parseBody(req);
      const id = String(body.id || "").trim().toUpperCase();
      const name = String(body.name || "").trim();
      const department = String(body.department || "").trim();

      if (!id || !name || !department) {
        sendJson(res, 400, { message: "id, name, and department are required." }, corsOrigin);
        return;
      }

      const exists = await query("SELECT id, active, device_token, device_label, device_bound_at FROM employees WHERE id = $1", [id]);

      const insertRes = await query(
        `INSERT INTO employees (id, name, department, active, device_token, device_label, device_bound_at)
         VALUES ($1, $2, $3, true, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             department = EXCLUDED.department,
             active = true
         RETURNING id, name, department`,
        [id, name, department, exists.rows[0]?.device_token || null, exists.rows[0]?.device_label || null, exists.rows[0]?.device_bound_at || null]
      );

      sendJson(
        res,
        exists.rows[0] ? 200 : 201,
        { message: exists.rows[0] ? "Employee restored successfully." : "Employee added successfully.", employee: insertRes.rows[0] },
        corsOrigin
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/admin/remove-employee") {
      if (!requireAdminSession(req, res, corsOrigin)) return;
      const body = await parseBody(req);
      const id = String(body.id || "").trim().toUpperCase();
      if (!id) {
        sendJson(res, 400, { message: "Employee ID is required." }, corsOrigin);
        return;
      }

      const exists = await query("SELECT id FROM employees WHERE id = $1 AND active = true", [id]);
      if (!exists.rows[0]) {
        sendJson(res, 404, { message: "Employee not found or already removed." }, corsOrigin);
        return;
      }

      await query("UPDATE employees SET active = false, device_token = NULL, device_label = NULL, device_bound_at = NULL WHERE id = $1", [id]);
      sendJson(res, 200, { message: "Employee removed successfully." }, corsOrigin);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/admin/reset-device") {
      if (!requireAdminSession(req, res, corsOrigin)) return;
      const body = await parseBody(req);
      const id = String(body.id || "").trim().toUpperCase();
      if (!id) {
        sendJson(res, 400, { message: "Employee ID is required." }, corsOrigin);
        return;
      }

      const exists = await query("SELECT id FROM employees WHERE id = $1 AND active = true", [id]);
      if (!exists.rows[0]) {
        sendJson(res, 404, { message: "Employee not found or inactive." }, corsOrigin);
        return;
      }

      await query("UPDATE employees SET device_token = NULL, device_label = NULL, device_bound_at = NULL WHERE id = $1", [id]);
      sendJson(res, 200, { message: "Company laptop binding reset successfully." }, corsOrigin);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/admin/import-employees") {
      if (!requireAdminSession(req, res, corsOrigin)) return;

      const body = await parseBody(req);
      const employees = Array.isArray(body.employees) ? body.employees : [];
      if (!employees.length) {
        sendJson(res, 400, { message: "employees array is required." }, corsOrigin);
        return;
      }

      let inserted = 0;
      let updated = 0;
      let skipped = 0;

      for (const item of employees) {
        const id = String(item.id || "").trim().toUpperCase();
        const name = String(item.name || "").trim();
        const department = String(item.department || "").trim();

        if (!id || !name || !department) {
          skipped += 1;
          continue;
        }

        const exists = await query("SELECT id FROM employees WHERE id = $1", [id]);
        await query(
          `INSERT INTO employees (id, name, department)
           VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE
           SET name = EXCLUDED.name,
               department = EXCLUDED.department`,
          [id, name, department]
        );

        if (exists.rows[0]) updated += 1;
        else inserted += 1;
      }

      sendJson(
        res,
        200,
        {
          message: "Employee import completed.",
          inserted,
          updated,
          skipped,
        },
        corsOrigin
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/admin/export-attendance") {
      if (!requireAdminSession(req, res, corsOrigin)) return;

      const dbRes = await query(
        `SELECT
           a.employee_id,
           e.name,
           e.department,
           a.attendance_date,
           a.check_in_at,
           a.check_out_at,
           a.total_hours,
           a.status
         FROM attendance a
         LEFT JOIN employees e ON e.id = a.employee_id
         ORDER BY a.attendance_date DESC, a.employee_id ASC`
      );

      const header = [
        "employee_id",
        "employee_name",
        "department",
        "date",
        "check_in",
        "check_out",
        "total_hours",
        "status",
      ];
      const rows = dbRes.rows.map((row) => [
        row.employee_id,
        row.name || "",
        row.department || "",
        row.attendance_date,
        row.check_in_at ? toISTDateTime(row.check_in_at) : "",
        row.check_out_at ? toISTDateTime(row.check_out_at) : "",
        Number(row.total_hours),
        row.status,
      ]);
      const csv = [header, ...rows]
        .map((row) => row.map(csvCell).join(","))
        .join("\n");

      sendCsv(res, csv, corsOrigin, `attendance-export-${getISTDate()}.csv`);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/attendance/today") {
      const employeeId = String(url.searchParams.get("employeeId") || "").trim().toUpperCase();
      if (!employeeId) return sendJson(res, 400, { message: "employeeId is required." }, corsOrigin);

      const today = getISTDate();
      const config = await readConfig();
      const dbRes = await query(
        `SELECT attendance_date, check_in_at, check_out_at, total_hours, status
         FROM attendance
         WHERE employee_id = $1 AND attendance_date = $2`,
        [employeeId, today]
      );

      sendJson(res, 200, { today, record: dbRes.rows[0] ? mapAttendance(dbRes.rows[0], config) : null }, corsOrigin);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/attendance/history") {
      const employeeId = String(url.searchParams.get("employeeId") || "").trim().toUpperCase();
      if (!employeeId) return sendJson(res, 400, { message: "employeeId is required." }, corsOrigin);

      const config = await readConfig();
      const dbRes = await query(
        `SELECT attendance_date, check_in_at, check_out_at, total_hours, status
         FROM attendance
         WHERE employee_id = $1
         ORDER BY attendance_date DESC, check_in_at DESC
         LIMIT 20`,
        [employeeId]
      );

      sendJson(res, 200, { records: dbRes.rows.map((row) => mapAttendance(row, config)) }, corsOrigin);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/admin/monthly-summary") {
      if (!requireAdminSession(req, res, corsOrigin)) return;

      const month = String(url.searchParams.get("month") || "").trim();
      const config = await readConfig();
      const { start, end, month: safeMonth } = getMonthBounds(month);

      const [employeesRes, attendanceRes] = await Promise.all([
        query("SELECT id, name, department FROM employees WHERE active = true ORDER BY id"),
        query(
          `SELECT a.employee_id, a.attendance_date, a.check_in_at, a.check_out_at, a.total_hours, a.status
           FROM attendance a
           WHERE a.check_in_at >= $1 AND a.check_in_at < $2
           ORDER BY a.employee_id ASC, a.attendance_date ASC`,
          [start, end]
        ),
      ]);

      const summary = new Map(
        employeesRes.rows.map((employee) => [
          employee.id,
          {
            employeeId: employee.id,
            name: employee.name,
            department: employee.department,
            daysPresent: 0,
            lateDays: 0,
            overtimeHours: 0,
            totalHours: 0,
          },
        ])
      );

      for (const row of attendanceRes.rows) {
        const employee = summary.get(row.employee_id);
        if (!employee) continue;

        const metrics = buildDailyMetrics(row, config);
        employee.daysPresent += 1;
        employee.totalHours += Number(row.total_hours || 0);
        employee.overtimeHours += metrics.overtimeHours;
        if (metrics.lateMark) employee.lateDays += 1;
      }

      const records = Array.from(summary.values()).map((item) => ({
        ...item,
        totalHours: Number(item.totalHours.toFixed(2)),
        overtimeHours: Number(item.overtimeHours.toFixed(2)),
        month: safeMonth,
      }));

      sendJson(res, 200, { month: safeMonth, shift: config.shift || null, records }, corsOrigin);
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

        sendJson(res, 200, { message: "Check-in marked successfully.", record: mapAttendance(insertRes.rows[0], config) }, corsOrigin);
        return;
      }

      if (!existing?.check_in_at) return sendJson(res, 409, { message: "No check-in found for today." }, corsOrigin);

      if (existing.check_out_at && now <= Number(existing.check_out_at)) {
        return sendJson(
          res,
          409,
          { message: "A later check-out is required to update the logout time." },
          corsOrigin
        );
      }

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

      sendJson(
        res,
        200,
        {
          message: existing.check_out_at
            ? "Check-out updated successfully."
            : "Check-out marked successfully.",
          record: mapAttendance(updateRes.rows[0], config),
        },
        corsOrigin
      );
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
    return ensureDefaultEmployees();
  })
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Attendance backend running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize database:", error);
    process.exit(1);
  });
