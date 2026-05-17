# Attendance App Deployment Guide

## 1) Deploy Backend + PostgreSQL on Render

1. Push this project to GitHub.
2. In Render, create a **Blueprint** using `render.yaml` from repo root.
3. After creation, open backend service env vars and set:
   - `PGHOST` = your Render Postgres host
   - `PGUSER` = your Render Postgres user
   - `PGPASSWORD` = your Render Postgres password
   - `PGDATABASE` = `attendance_app`
   - `PGPORT` = `5432`
   - `ALLOWED_ORIGINS` = your Vercel domain (example: `https://attendance-frontend.vercel.app`)
   - `OFFICE_ALLOWED_IPS` = your office public IP address (example: `203.0.113.10`)
4. Open Render backend shell and run:
   - `npm run seed`

## 2) Deploy Frontend on Vercel

1. Import repo in Vercel.
2. Set **Root Directory** to `frontend`.
3. Deploy once.
4. In deployed frontend, update `frontend/public/config.js` API base:
   - `API_BASE: "https://<your-render-backend>.onrender.com/api"`
5. Redeploy frontend.

## 3) Final Check

1. Open Vercel URL on mobile.
2. Login with sample IDs: `EMP001`, `EMP002`, `EMP003`.
3. Allow location permission.
4. Test check-in and check-out.

## Notes

- Geofence coordinates are stored in `backend/data/config.json`.
- On backend CORS, use exact Vercel URL in `ALLOWED_ORIGINS`.
- For multiple domains, use comma-separated values in `ALLOWED_ORIGINS`.
- For multiple office internet connections, use comma-separated values in `OFFICE_ALLOWED_IPS`.
- If `OFFICE_ALLOWED_IPS` is empty, the office public IP check is disabled.
