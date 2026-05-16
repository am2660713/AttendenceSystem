import { initDb, query } from "./db.js";

const employees = [
  { id: "EMP001", name: "Aarav Sharma", department: "Sales" },
  { id: "EMP002", name: "Priya Verma", department: "HR" },
  { id: "EMP003", name: "Rohit Singh", department: "Operations" },
];

const seed = async () => {
  await initDb();

  for (const employee of employees) {
    await query(
      `
        INSERT INTO employees (id, name, department)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            department = EXCLUDED.department;
      `,
      [employee.id, employee.name, employee.department]
    );
  }

  console.log("Employees seeded successfully.");
  process.exit(0);
};

seed().catch((error) => {
  console.error("Seed failed:", error.message);
  process.exit(1);
});
