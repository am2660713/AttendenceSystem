import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const { Pool } = pg;

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

const pool = hasDatabaseUrl
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
    })
  : new Pool({
      host: process.env.PGHOST || "localhost",
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || "postgres",
      password: process.env.PGPASSWORD || "postgres",
      database: process.env.PGDATABASE || "attendance_app",
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
    });

export const query = (text, params = []) => pool.query(text, params);

export const initDb = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      department TEXT NOT NULL,
      device_token TEXT,
      device_label TEXT,
      device_bound_at TIMESTAMPTZ,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
  `);

  await query(`
    ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS device_token TEXT;
  `);

  await query(`
    ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS device_label TEXT;
  `);

  await query(`
    ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS device_bound_at TIMESTAMPTZ;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS attendance (
      id BIGSERIAL PRIMARY KEY,
      employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      attendance_date DATE NOT NULL,
      check_in_at BIGINT,
      check_out_at BIGINT,
      total_hours NUMERIC(6,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'IN',
      check_in_latitude DOUBLE PRECISION,
      check_in_longitude DOUBLE PRECISION,
      check_out_latitude DOUBLE PRECISION,
      check_out_longitude DOUBLE PRECISION,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(employee_id, attendance_date)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
};
