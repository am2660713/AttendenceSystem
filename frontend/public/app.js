const API_BASE = window.__APP_CONFIG__?.API_BASE || "http://localhost:4000/api";

const loginCard = document.getElementById("loginCard");
const dashboardCard = document.getElementById("dashboardCard");
const employeeIdInput = document.getElementById("employeeId");
const loginBtn = document.getElementById("loginBtn");
const loginMsg = document.getElementById("loginMsg");
const empName = document.getElementById("empName");
const empDept = document.getElementById("empDept");
const todayStatus = document.getElementById("todayStatus");
const checkInBtn = document.getElementById("checkInBtn");
const checkOutBtn = document.getElementById("checkOutBtn");
const actionMsg = document.getElementById("actionMsg");
const historyEl = document.getElementById("history");
const logoutBtn = document.getElementById("logoutBtn");
const newEmployeeId = document.getElementById("newEmployeeId");
const newEmployeeName = document.getElementById("newEmployeeName");
const newEmployeeDepartment = document.getElementById("newEmployeeDepartment");
const addEmployeeBtn = document.getElementById("addEmployeeBtn");
const importEmployeesBtn = document.getElementById("importEmployeesBtn");
const importEmployeesInput = document.getElementById("importEmployeesInput");
const exportAttendanceBtn = document.getElementById("exportAttendanceBtn");
const adminMsg = document.getElementById("adminMsg");
const employeeList = document.getElementById("employeeList");
const adminPasswordInput = document.getElementById("adminPassword");
const unlockAdminBtn = document.getElementById("unlockAdminBtn");
const unlockMsg = document.getElementById("unlockMsg");
const lockAdminBtn = document.getElementById("lockAdminBtn");
const adminTabBtn = document.getElementById("adminTabBtn");
const adminModal = document.getElementById("adminModal");
const closeAdminModalBtn = document.getElementById("closeAdminModalBtn");
const adminPanelModal = document.getElementById("adminPanelModal");
const closeAdminPanelBtn = document.getElementById("closeAdminPanelBtn");

let currentEmployee = null;
localStorage.removeItem("adminUnlocked");
let adminUnlocked = false;
let adminToken = null;

const setMessage = (el, text, ok = false) => {
  el.textContent = text;
  el.style.color = ok ? "#0f766e" : "#b91c1c";
};

const callApi = async (path, method = "GET", body, extraHeaders = {}) => {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Request failed");
  return data;
};

const getLocation = () =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported on this device/browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position.coords),
      () => reject(new Error("Location permission denied. Please allow location and retry.")),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });

const renderToday = async () => {
  const today = await callApi(`/attendance/today?employeeId=${currentEmployee.id}`);
  if (!today.record) {
    todayStatus.textContent = `No attendance found for ${today.today}.`;
    return;
  }

  todayStatus.textContent = `Date: ${today.record.date} | In: ${today.record.checkInAt || "-"} | Out: ${today.record.checkOutAt || "-"} | Hours: ${today.record.totalHours}`;
};

const renderHistory = async () => {
  const data = await callApi(`/attendance/history?employeeId=${currentEmployee.id}`);
  if (!data.records.length) {
    historyEl.innerHTML = "<p class='muted'>No previous records.</p>";
    return;
  }

  historyEl.innerHTML = data.records
    .map(
      (r) =>
        `<div class="record"><strong>${r.date}</strong><br/>In: ${r.checkInAt || "-"}<br/>Out: ${r.checkOutAt || "-"}<br/>Hours: ${r.totalHours}</div>`
    )
    .join("");
};

const refresh = async () => {
  await Promise.all([renderToday(), renderHistory()]);
};

const closeAdminPanels = (lock = true) => {
  if (lock) {
    adminUnlocked = false;
    adminToken = null;
  }
  adminModal.classList.add("hidden");
  adminPanelModal.classList.add("hidden");
  adminPasswordInput.value = "";
  unlockMsg.textContent = "";
  if (lock) {
    adminMsg.textContent = "";
  }
};

const applyAdminVisibility = () => {
  closeAdminPanels(true);
};

const renderEmployees = async () => {
  const data = await callApi("/employees", "GET", undefined, { "x-admin-token": adminToken || "" });
  if (!data.employees.length) {
    employeeList.innerHTML = "<p class='muted'>No employees found.</p>";
    return;
  }

  employeeList.innerHTML = data.employees
    .map(
      (emp) =>
        `<div class="record employee-row" data-employee-id="${emp.id}">
          <div>
            <strong>${emp.id}</strong><br/>
            ${emp.name}<br/>
            ${emp.department}
          </div>
          <button class="mini-danger remove-employee-btn" data-employee-id="${emp.id}" type="button">Remove</button>
        </div>`
    )
    .join("");
};

const parseCsvLine = (line) => {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
};

const parseEmployeesCsv = (text) => {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("CSV file is empty.");
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
  const idIndex = headers.indexOf("id");
  const nameIndex = headers.indexOf("name");
  const departmentIndex = headers.indexOf("department");

  if (idIndex < 0 || nameIndex < 0 || departmentIndex < 0) {
    throw new Error("CSV must include id, name, department columns.");
  }

  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    return {
      id: cols[idIndex] || "",
      name: cols[nameIndex] || "",
      department: cols[departmentIndex] || "",
    };
  });
};

loginBtn.addEventListener("click", async () => {
  try {
    loginMsg.textContent = "";
    const employeeId = employeeIdInput.value.trim().toUpperCase();
    if (!employeeId) throw new Error("Enter employee ID");

    const { employee } = await callApi("/auth/login", "POST", { employeeId });
    currentEmployee = employee;
    localStorage.setItem("attendanceEmployee", JSON.stringify(employee));

    empName.textContent = `${employee.name} (${employee.id})`;
    empDept.textContent = employee.department;

    loginCard.classList.add("hidden");
    dashboardCard.classList.remove("hidden");

    await refresh();
    setMessage(loginMsg, "Login successful", true);
  } catch (error) {
    setMessage(loginMsg, error.message);
  }
});

const markAttendance = async (path) => {
  try {
    setMessage(actionMsg, "Reading location...", true);
    const coords = await getLocation();

    const data = await callApi(path, "POST", {
      employeeId: currentEmployee.id,
      latitude: coords.latitude,
      longitude: coords.longitude,
    });

    setMessage(actionMsg, data.message, true);
    await refresh();
  } catch (error) {
    setMessage(actionMsg, error.message);
  }
};

checkInBtn.addEventListener("click", () => markAttendance("/attendance/check-in"));
checkOutBtn.addEventListener("click", () => markAttendance("/attendance/check-out"));

logoutBtn.addEventListener("click", () => {
  currentEmployee = null;
  localStorage.removeItem("attendanceEmployee");
  dashboardCard.classList.add("hidden");
  loginCard.classList.remove("hidden");
  employeeIdInput.value = "";
  actionMsg.textContent = "";
});

addEmployeeBtn.addEventListener("click", async () => {
  try {
    if (!adminUnlocked) throw new Error("Unlock admin first.");
    const id = newEmployeeId.value.trim().toUpperCase();
    const name = newEmployeeName.value.trim();
    const department = newEmployeeDepartment.value.trim();

    if (!id || !name || !department) throw new Error("Please fill all employee fields.");

    const data = await callApi("/employees", "POST", { id, name, department }, { "x-admin-token": adminToken || "" });
    setMessage(adminMsg, data.message, true);
    newEmployeeId.value = "";
    newEmployeeName.value = "";
    newEmployeeDepartment.value = "";
    await renderEmployees();
  } catch (error) {
    setMessage(adminMsg, error.message);
  }
});

employeeList.addEventListener("click", async (event) => {
  const button = event.target.closest(".remove-employee-btn");
  if (!button) return;

  const employeeId = button.dataset.employeeId;
  if (!employeeId) return;

  if (!window.confirm(`Remove ${employeeId}? This will deactivate the employee, but keep past attendance records.`)) {
    return;
  }

  try {
    const data = await callApi(
      "/admin/remove-employee",
      "POST",
      { id: employeeId },
      { "x-admin-token": adminToken || "" }
    );
    setMessage(adminMsg, data.message, true);
    await renderEmployees();
  } catch (error) {
    setMessage(adminMsg, error.message);
  }
});

importEmployeesBtn.addEventListener("click", () => {
  if (!adminUnlocked || !adminToken) {
    setMessage(adminMsg, "Unlock admin first.");
    return;
  }
  importEmployeesInput.click();
});

importEmployeesInput.addEventListener("change", async () => {
  try {
    if (!adminUnlocked || !adminToken) throw new Error("Unlock admin first.");
    const file = importEmployeesInput.files?.[0];
    if (!file) return;

    const text = await file.text();
    const employees = parseEmployeesCsv(text);
    if (!employees.length) throw new Error("No employee rows found.");

    const data = await callApi(
      "/admin/import-employees",
      "POST",
      { employees },
      { "x-admin-token": adminToken || "" }
    );

    setMessage(
      adminMsg,
      `${data.message} Inserted: ${data.inserted}, updated: ${data.updated}, skipped: ${data.skipped}.`,
      true
    );
    importEmployeesInput.value = "";
    await renderEmployees();
  } catch (error) {
    importEmployeesInput.value = "";
    setMessage(adminMsg, error.message);
  }
});

unlockAdminBtn.addEventListener("click", async () => {
  try {
    const password = adminPasswordInput.value.trim();
    if (!password) throw new Error("Enter admin password.");
    const data = await callApi("/admin/unlock", "POST", { password });
    adminUnlocked = true;
    adminToken = data.token;
    adminModal.classList.add("hidden");
    adminPasswordInput.value = "";
    unlockMsg.textContent = "";
    adminPanelModal.classList.remove("hidden");
    setMessage(adminMsg, data.message, true);
    await renderEmployees();
  } catch (error) {
    setMessage(unlockMsg, error.message);
  }
});

exportAttendanceBtn.addEventListener("click", async () => {
  try {
    if (!adminToken) throw new Error("Unlock admin first.");
    const res = await fetch(`${API_BASE}/admin/export-attendance`, {
      method: "GET",
      headers: { "x-admin-token": adminToken },
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || "Export failed");
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "attendance-export.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    setMessage(adminMsg, "Attendance exported successfully.", true);
  } catch (error) {
    setMessage(adminMsg, error.message);
  }
});

lockAdminBtn.addEventListener("click", () => {
  closeAdminPanels(true);
});

adminTabBtn.addEventListener("click", () => {
  adminUnlocked = false;
  adminToken = null;
  adminPanelModal.classList.add("hidden");
  adminModal.classList.remove("hidden");
  adminPasswordInput.focus();
});

closeAdminModalBtn.addEventListener("click", () => {
  closeAdminPanels(true);
});

adminModal.addEventListener("click", (event) => {
  if (event.target === adminModal) {
    closeAdminPanels(true);
  }
});

closeAdminPanelBtn.addEventListener("click", () => {
  closeAdminPanels(true);
});

adminPanelModal.addEventListener("click", (event) => {
  if (event.target === adminPanelModal) {
    closeAdminPanels(true);
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeAdminPanels(true);
  }
});

const bootstrap = async () => {
  const cached = localStorage.getItem("attendanceEmployee");
  if (!cached) return;

  try {
    currentEmployee = JSON.parse(cached);
    empName.textContent = `${currentEmployee.name} (${currentEmployee.id})`;
    empDept.textContent = currentEmployee.department;
    loginCard.classList.add("hidden");
    dashboardCard.classList.remove("hidden");
    await refresh();
  } catch {
    localStorage.removeItem("attendanceEmployee");
  }
};

bootstrap();
applyAdminVisibility();
window.addEventListener("pageshow", applyAdminVisibility);
