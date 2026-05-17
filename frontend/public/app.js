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
const officeNameInput = document.getElementById("officeName");
const officeLatitudeInput = document.getElementById("officeLatitude");
const officeLongitudeInput = document.getElementById("officeLongitude");
const officeRadiusInput = document.getElementById("officeRadius");
const officeAllowedIpsInput = document.getElementById("officeAllowedIps");
const saveOfficeLocationBtn = document.getElementById("saveOfficeLocationBtn");
const officeLocationMsg = document.getElementById("officeLocationMsg");
const currentAdminPasswordInput = document.getElementById("currentAdminPassword");
const newAdminPasswordInput = document.getElementById("newAdminPassword");
const confirmAdminPasswordInput = document.getElementById("confirmAdminPassword");
const toggleCurrentAdminPasswordBtn = document.getElementById("toggleCurrentAdminPasswordBtn");
const toggleNewAdminPasswordBtn = document.getElementById("toggleNewAdminPasswordBtn");
const changeAdminPasswordBtn = document.getElementById("changeAdminPasswordBtn");
const changeAdminPasswordMsg = document.getElementById("changeAdminPasswordMsg");
const employeeList = document.getElementById("employeeList");
const summarySearchInput = document.getElementById("summarySearch");
const summaryDepartmentFilter = document.getElementById("summaryDepartment");
const summaryMonth = document.getElementById("summaryMonth");
const summaryPageSize = document.getElementById("summaryPageSize");
const loadSummaryBtn = document.getElementById("loadSummaryBtn");
const summaryPrevBtn = document.getElementById("summaryPrevBtn");
const summaryNextBtn = document.getElementById("summaryNextBtn");
const summaryPageInfo = document.getElementById("summaryPageInfo");
const summaryStats = document.getElementById("summaryStats");
const summaryTable = document.getElementById("summaryTable");
const employeePageSize = document.getElementById("employeePageSize");
const employeePrevBtn = document.getElementById("employeePrevBtn");
const employeeNextBtn = document.getElementById("employeeNextBtn");
const employeePageInfo = document.getElementById("employeePageInfo");
const adminPasswordInput = document.getElementById("adminPassword");
const toggleAdminPasswordBtn = document.getElementById("toggleAdminPasswordBtn");
const unlockAdminBtn = document.getElementById("unlockAdminBtn");
const unlockMsg = document.getElementById("unlockMsg");
const lockAdminBtn = document.getElementById("lockAdminBtn");
const adminTabBtn = document.getElementById("adminTabBtn");
const adminModal = document.getElementById("adminModal");
const closeAdminModalBtn = document.getElementById("closeAdminModalBtn");
const adminPanelModal = document.getElementById("adminPanelModal");
const closeAdminPanelBtn = document.getElementById("closeAdminPanelBtn");
const adminViewButtons = document.querySelectorAll("[data-admin-view-btn]");
const adminViewPanes = document.querySelectorAll("[data-admin-view]");

let currentEmployee = null;
let employeeToken = localStorage.getItem("attendanceEmployeeToken") || null;
localStorage.removeItem("adminUnlocked");
let adminUnlocked = false;
let adminToken = null;
let activeAdminView = "tools";
let summaryPage = 1;
let summaryTotalPages = 1;
let employeePage = 1;
let employeeTotalPages = 1;
const deviceTokenKey = "attendanceDeviceToken";
const getDeviceToken = () => {
  const existing = localStorage.getItem(deviceTokenKey);
  if (existing) return existing;
  const token = crypto.randomUUID();
  localStorage.setItem(deviceTokenKey, token);
  return token;
};
const getDeviceLabel = () => {
  const parts = [navigator.platform || "Unknown device", navigator.userAgent || "Browser"];
  return parts.filter(Boolean).join(" / ").slice(0, 255);
};
const getISTMonthValue = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7);

if (summaryMonth) {
  summaryMonth.value = getISTMonthValue();
}

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
  const today = await callApi(
    `/attendance/today?employeeId=${currentEmployee.id}`,
    "GET",
    undefined,
    { "x-employee-token": employeeToken || "" }
  );
  if (!today.record) {
    todayStatus.textContent = `No attendance found for ${today.today}.`;
    return;
  }

  todayStatus.textContent = `Date: ${today.record.date} | In: ${today.record.checkInAt || "-"} | Out: ${today.record.checkOutAt || "-"} | Hours: ${today.record.totalHours}`;
};

const renderHistory = async () => {
  const data = await callApi(
    `/attendance/history?employeeId=${currentEmployee.id}`,
    "GET",
    undefined,
    { "x-employee-token": employeeToken || "" }
  );
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
  adminPanelModal.classList.remove("summary-mode", "tools-mode", "list-mode");
  adminPasswordInput.value = "";
  unlockMsg.textContent = "";
  if (currentAdminPasswordInput) currentAdminPasswordInput.value = "";
  if (newAdminPasswordInput) newAdminPasswordInput.value = "";
  if (confirmAdminPasswordInput) confirmAdminPasswordInput.value = "";
  if (changeAdminPasswordMsg) changeAdminPasswordMsg.textContent = "";
  if (toggleCurrentAdminPasswordBtn) toggleCurrentAdminPasswordBtn.textContent = "Show";
  if (toggleNewAdminPasswordBtn) toggleNewAdminPasswordBtn.textContent = "Show";
  if (currentAdminPasswordInput) currentAdminPasswordInput.type = "password";
  if (newAdminPasswordInput) newAdminPasswordInput.type = "password";
  if (confirmAdminPasswordInput) confirmAdminPasswordInput.type = "password";
  if (lock) {
    adminMsg.textContent = "";
  }
};

const setAdminView = (view) => {
  activeAdminView = view;
  adminPanelModal.classList.toggle("summary-mode", view === "summary");
  adminPanelModal.classList.toggle("tools-mode", view === "tools");
  adminPanelModal.classList.toggle("list-mode", view === "list");
  adminViewButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.adminViewBtn === view);
  });
  adminViewPanes.forEach((pane) => {
    pane.classList.toggle("hidden", pane.dataset.adminView !== view);
  });

  if (view === "summary") {
    summaryPage = 1;
    renderSummary();
  } else if (view === "list") {
    employeePage = 1;
    renderEmployees();
  } else if (view === "tools") {
    loadOfficeSettings();
  } else if (view === "security") {
    // Password page is self-contained.
  }
};

const applyAdminVisibility = () => {
  closeAdminPanels(true);
};

const loadOfficeSettings = async () => {
  if (!officeNameInput || !officeLatitudeInput || !officeLongitudeInput || !officeRadiusInput || !officeAllowedIpsInput) return;

  try {
    const config = await callApi("/config");
    const office = config.office || {};
    officeNameInput.value = office.name || "";
    officeLatitudeInput.value = office.latitude ?? "";
    officeLongitudeInput.value = office.longitude ?? "";
    officeRadiusInput.value = office.radiusMeters ?? "";
    officeAllowedIpsInput.value = Array.isArray(office.allowedIps) ? office.allowedIps.join("\n") : "";
    if (officeLocationMsg) officeLocationMsg.textContent = "";
  } catch (error) {
    if (officeLocationMsg) setMessage(officeLocationMsg, error.message);
  }
};

const setPasswordFieldVisibility = (input, button) => {
  if (!input || !button) return;
  const isPassword = input.type === "password";
  input.type = isPassword ? "text" : "password";
  button.textContent = isPassword ? "Hide" : "Show";
  button.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
};

const getAdminFilters = (searchInput, departmentInput) => ({
  search: String(searchInput?.value || "").trim(),
  department: String(departmentInput?.value || "All").trim(),
});

const renderEmployees = async () => {
  const pageSize = Number(employeePageSize?.value || 10);
  const params = new URLSearchParams({
    page: String(employeePage),
    pageSize: String(pageSize),
  });
  const data = await callApi(`/employees?${params.toString()}`, "GET", undefined, {
    "x-admin-token": adminToken || "",
  });
  employeeTotalPages = Number(data.totalPages || 1);
  if (employeePage > employeeTotalPages) employeePage = employeeTotalPages;
  const pageItems = Array.isArray(data.employees) ? data.employees : [];

  if (!pageItems.length) {
    employeeList.innerHTML = "<p class='muted'>No employees found.</p>";
    if (employeePageInfo) employeePageInfo.textContent = `Page ${employeePage} of ${employeeTotalPages}`;
    if (employeePrevBtn) employeePrevBtn.disabled = employeePage <= 1;
    if (employeeNextBtn) employeeNextBtn.disabled = employeePage >= employeeTotalPages;
    return;
  }

  employeeList.innerHTML = `
    <div class="employee-table-wrap">
      <table class="employee-table">
        <colgroup>
          <col style="width: 280px" />
          <col style="width: 180px" />
          <col style="width: 760px" />
          <col style="width: 260px" />
        </colgroup>
        <thead>
          <tr>
            <th>Employee</th>
            <th>Department</th>
            <th>Laptop Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${pageItems
            .map(
              (emp) => `
                <tr data-employee-id="${emp.id}">
                  <td class="employee-name-cell">
                    <strong>${emp.name}</strong>
                    <span class="employee-code">${emp.id}</span>
                  </td>
                  <td>${emp.department}</td>
                  <td>
                    <span class="pin-badge">${
                      emp.deviceBound
                        ? `Approved company laptop${emp.deviceLabel ? `: ${emp.deviceLabel}` : ""}`
                        : "Laptop not bound yet"
                    }</span>
                  </td>
                  <td class="employee-actions-cell">
                    <button class="mini-secondary reset-device-btn" data-employee-id="${emp.id}" type="button">Reset Laptop</button>
                    <button class="mini-danger remove-employee-btn" data-employee-id="${emp.id}" type="button">Remove</button>
                  </td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
  if (employeePageInfo) employeePageInfo.textContent = `Page ${employeePage} of ${employeeTotalPages}`;
  if (employeePrevBtn) employeePrevBtn.disabled = employeePage <= 1;
  if (employeeNextBtn) employeeNextBtn.disabled = employeePage >= employeeTotalPages;
};

const applySummaryFilters = async () => {
  summaryPage = 1;
  await renderSummary();
};

const renderSummary = async () => {
  if (!summaryMonth || !summaryStats || !summaryTable) return;
  if (!adminUnlocked || !adminToken) {
    summaryStats.textContent = "Unlock admin to view HR monthly summary.";
    summaryTable.innerHTML = "<p class='muted'>Monthly summary is available after admin unlock.</p>";
    return;
  }

  try {
    const month = summaryMonth.value || getISTMonthValue();
    const pageSize = Number(summaryPageSize?.value || 10);
    const filters = getAdminFilters(summarySearchInput, summaryDepartmentFilter);
    const params = new URLSearchParams({
      month,
      page: String(summaryPage),
      pageSize: String(pageSize),
    });
    if (filters.search) params.set("search", filters.search);
    if (filters.department && filters.department !== "All") params.set("department", filters.department);
    const data = await callApi(
      `/admin/monthly-summary?${params.toString()}`,
      "GET",
      undefined,
      {
      "x-admin-token": adminToken || "",
      }
    );
    summaryTotalPages = Number(data.totalPages || 1);

    const records = Array.isArray(data.records) ? data.records : [];
    const stats = data.stats || {};
    const lateDays = Number(stats.lateDays || 0);
    const overtimeHours = Number(stats.overtimeHours || 0);
    const totalPresentDays = Number(stats.presentDays || 0);
    const totalEmployees = Number(stats.employees || records.length);
    const shift = data.shift || {};
    const shiftText = shift.start && shift.end
      ? `${shift.start} - ${shift.end} (Grace ${Number(shift.graceMinutes || 0)} mins)`
      : "Shift rules not configured";

    summaryStats.innerHTML = `
      <strong>Month:</strong> ${data.month}
      &nbsp; | &nbsp;<strong>Shift:</strong> ${shiftText}
      &nbsp; | &nbsp;<strong>Employees:</strong> ${totalEmployees}
      &nbsp; | &nbsp;<strong>Present days:</strong> ${totalPresentDays}
      &nbsp; | &nbsp;<strong>Late days:</strong> ${lateDays}
      &nbsp; | &nbsp;<strong>Overtime hrs:</strong> ${overtimeHours.toFixed(2)}
    `;

    if (!records.length) {
      summaryTable.innerHTML = "<p class='muted'>No monthly attendance found for the current filters.</p>";
      if (summaryPageInfo) summaryPageInfo.textContent = `Page ${summaryPage} of ${summaryTotalPages}`;
      return;
    }

    summaryTable.innerHTML = `
      <div class="summary-table-wrap">
        <table class="summary-table">
          <colgroup>
            <col style="width: 34%" />
            <col style="width: 22%" />
            <col style="width: 10%" />
            <col style="width: 10%" />
            <col style="width: 12%" />
            <col style="width: 12%" />
          </colgroup>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Department</th>
              <th>Present</th>
              <th>Late</th>
              <th>OT hrs</th>
              <th>Total hrs</th>
            </tr>
          </thead>
          <tbody>
              ${records
              .map(
                (item) => `
                  <tr>
                    <td class="summary-employee-cell"><strong>${item.name}</strong></td>
                    <td>${item.department}</td>
                    <td>${Number(item.daysPresent || 0)}</td>
                    <td>${Number(item.lateDays || 0)}</td>
                    <td>${Number(item.overtimeHours || 0).toFixed(2)}</td>
                    <td>${Number(item.totalHours || 0).toFixed(2)}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
    if (summaryPageInfo) summaryPageInfo.textContent = `Page ${data.page || summaryPage} of ${summaryTotalPages}`;
    if (summaryPrevBtn) summaryPrevBtn.disabled = (data.page || summaryPage) <= 1;
    if (summaryNextBtn) summaryNextBtn.disabled = (data.page || summaryPage) >= summaryTotalPages;
  } catch (error) {
    summaryStats.textContent = "";
    summaryTable.innerHTML = `<p class='msg'>${error.message}</p>`;
  }
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

    const { employee, message, token } = await callApi("/auth/login", "POST", {
      employeeId,
      deviceToken: getDeviceToken(),
      deviceLabel: getDeviceLabel(),
    });
    currentEmployee = employee;
    employeeToken = token;
    localStorage.setItem("attendanceEmployee", JSON.stringify(employee));
    localStorage.setItem("attendanceEmployeeToken", token);

    empName.textContent = `${employee.name} (${employee.id})`;
    empDept.textContent = employee.department;

    loginCard.classList.add("hidden");
    dashboardCard.classList.remove("hidden");

    await refresh();
    setMessage(loginMsg, message || "Login successful", true);
  } catch (error) {
    setMessage(loginMsg, error.message);
  }
});

const markAttendance = async (path) => {
  try {
    setMessage(actionMsg, "Reading location...", true);
    const coords = await getLocation();

    const data = await callApi(
      path,
      "POST",
      {
        employeeId: currentEmployee.id,
        latitude: coords.latitude,
        longitude: coords.longitude,
      },
      { "x-employee-token": employeeToken || "" }
    );

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
  employeeToken = null;
  localStorage.removeItem("attendanceEmployee");
  localStorage.removeItem("attendanceEmployeeToken");
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
    await renderSummary();
  } catch (error) {
    setMessage(adminMsg, error.message);
  }
});

employeeList.addEventListener("click", async (event) => {
  const resetButton = event.target.closest(".reset-device-btn");
  const button = event.target.closest(".remove-employee-btn");
  if (!resetButton && !button) return;

  const employeeId = (resetButton || button).dataset.employeeId;
  if (!employeeId) return;

  try {
    if (resetButton) {
      const data = await callApi(
        "/admin/reset-device",
        "POST",
        { id: employeeId },
        { "x-admin-token": adminToken || "" }
      );
      setMessage(adminMsg, data.message, true);
    } else {
      if (!window.confirm(`Remove ${employeeId}? This will deactivate the employee, but keep past attendance records.`)) {
        return;
      }
      const data = await callApi(
        "/admin/remove-employee",
        "POST",
        { id: employeeId },
        { "x-admin-token": adminToken || "" }
      );
      setMessage(adminMsg, data.message, true);
    }
    await renderEmployees();
    await renderSummary();
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
    await renderSummary();
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
    setAdminView("tools");
    summaryPage = 1;
    employeePage = 1;
    await renderEmployees();
    await renderSummary();
    await loadOfficeSettings();
  } catch (error) {
    setMessage(unlockMsg, error.message);
  }
});

loadSummaryBtn.addEventListener("click", async () => {
  await applySummaryFilters();
});

summaryPageSize?.addEventListener("change", async () => {
  summaryPage = 1;
  await renderSummary();
});

employeePageSize?.addEventListener("change", async () => {
  employeePage = 1;
  await renderEmployees();
});

summarySearchInput?.addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    await applySummaryFilters();
  }
});

summaryPrevBtn?.addEventListener("click", async () => {
  if (summaryPage > 1) {
    summaryPage -= 1;
    await renderSummary();
  }
});

summaryNextBtn?.addEventListener("click", async () => {
  if (summaryPage < summaryTotalPages) {
    summaryPage += 1;
    await renderSummary();
  }
});

toggleAdminPasswordBtn?.addEventListener("click", () => {
  setPasswordFieldVisibility(adminPasswordInput, toggleAdminPasswordBtn);
});

toggleCurrentAdminPasswordBtn?.addEventListener("click", () => {
  setPasswordFieldVisibility(currentAdminPasswordInput, toggleCurrentAdminPasswordBtn);
});

toggleNewAdminPasswordBtn?.addEventListener("click", () => {
  setPasswordFieldVisibility(newAdminPasswordInput, toggleNewAdminPasswordBtn);
});

employeePrevBtn?.addEventListener("click", async () => {
  if (employeePage > 1) {
    employeePage -= 1;
    await renderEmployees();
  }
});

employeeNextBtn?.addEventListener("click", async () => {
  if (employeePage < employeeTotalPages) {
    employeePage += 1;
    await renderEmployees();
  }
});

saveOfficeLocationBtn?.addEventListener("click", async () => {
  try {
    if (!adminUnlocked || !adminToken) throw new Error("Unlock admin first.");

    const name = officeNameInput.value.trim();
    const latitude = Number(officeLatitudeInput.value);
    const longitude = Number(officeLongitudeInput.value);
    const radiusMeters = Number(officeRadiusInput.value);
    const allowedIps = officeAllowedIpsInput.value
      .split(/[\n,]+/)
      .map((value) => value.trim())
      .filter(Boolean);

    if (!name) throw new Error("Office name is required.");
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(radiusMeters)) {
      throw new Error("Enter valid latitude, longitude, and radius.");
    }

    const data = await callApi(
      "/admin/update-office",
      "POST",
      { name, latitude, longitude, radiusMeters, allowedIps },
      { "x-admin-token": adminToken || "" }
    );

    setMessage(officeLocationMsg, data.message, true);
    setMessage(adminMsg, "Office location updated.", true);
  } catch (error) {
    setMessage(officeLocationMsg, error.message);
  }
});

changeAdminPasswordBtn?.addEventListener("click", async () => {
  try {
    if (!adminUnlocked || !adminToken) throw new Error("Unlock admin first.");

    const currentPassword = currentAdminPasswordInput.value.trim();
    const newPassword = newAdminPasswordInput.value.trim();
    const confirmPassword = confirmAdminPasswordInput.value.trim();

    if (!currentPassword || !newPassword || !confirmPassword) {
      throw new Error("Fill all password fields.");
    }

    const data = await callApi(
      "/admin/change-password",
      "POST",
      { currentPassword, newPassword, confirmPassword },
      { "x-admin-token": adminToken || "" }
    );

    setMessage(changeAdminPasswordMsg, data.message, true);
    currentAdminPasswordInput.value = "";
    newAdminPasswordInput.value = "";
    confirmAdminPasswordInput.value = "";
    if (toggleCurrentAdminPasswordBtn) toggleCurrentAdminPasswordBtn.textContent = "Show";
    if (toggleNewAdminPasswordBtn) toggleNewAdminPasswordBtn.textContent = "Show";
    currentAdminPasswordInput.type = "password";
    newAdminPasswordInput.type = "password";
    confirmAdminPasswordInput.type = "password";
    setMessage(adminMsg, "Admin password updated.", true);
  } catch (error) {
    setMessage(changeAdminPasswordMsg, error.message);
  }
});

adminViewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (!adminUnlocked || !adminToken) {
      setMessage(adminMsg, "Unlock admin first.");
      return;
    }
    setAdminView(button.dataset.adminViewBtn || "tools");
  });
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
  adminPanelModal.classList.remove("summary-mode", "tools-mode", "list-mode");
  adminModal.classList.remove("hidden");
  adminPasswordInput.focus();
  setAdminView("tools");
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
  const cachedToken = localStorage.getItem("attendanceEmployeeToken");
  if (!cached || !cachedToken) return;

  try {
    currentEmployee = JSON.parse(cached);
    employeeToken = cachedToken;
    empName.textContent = `${currentEmployee.name} (${currentEmployee.id})`;
    empDept.textContent = currentEmployee.department;
    loginCard.classList.add("hidden");
    dashboardCard.classList.remove("hidden");
    await refresh();
  } catch {
    employeeToken = null;
    localStorage.removeItem("attendanceEmployee");
    localStorage.removeItem("attendanceEmployeeToken");
  }
};

bootstrap();
applyAdminVisibility();
window.addEventListener("pageshow", applyAdminVisibility);
