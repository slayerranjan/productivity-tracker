// Bulk salary load from a sheet. Dry run by default: it prints exactly what it
// would change and writes nothing until APPLY=1. Salary is the one number in
// this system nobody should be able to change by accident.

import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma.js";

const FILE = process.env.FILE ?? "salaries.csv";
const APPLY = process.env.APPLY === "1";

type Row = { code: string; salary: number; line: number };

function parse(text: string): { rows: Row[]; bad: string[] } {
  const rows: Row[] = [];
  const bad: string[] = [];
  // Excel writes a BOM at the start of a CSV; left in, it corrupts the first code.
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;

    const parts = line.split(",").map((p) => p.trim().replace(/^"|"$/g, ""));
    const code = parts[0] ?? "";
    // Tolerates "25,000", "Rs. 25000" and "₹25000" - HR sheets are never clean.
    const salaryText = (parts[1] ?? "").replace(/[^0-9.]/g, "");

    if (i === 0 && /employee|code/i.test(code)) return; // header row
    if (!code) return;

    const salary = Number(salaryText);
    if (!Number.isFinite(salary) || salary <= 0) {
      bad.push("line " + (i + 1) + ': "' + line + '" - no valid salary');
      return;
    }

    rows.push({
      code: code.toUpperCase(),
      salary: Math.round(salary * 100) / 100,
      line: i + 1,
    });
  });

  return { rows, bad };
}

async function main() {
  const file = path.isAbsolute(FILE) ? FILE : path.join(process.cwd(), FILE);

  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    console.log("Could not read " + file);
    console.log("Put a CSV there with two columns: employeeCode,monthlySalary");
    return;
  }

  const { rows, bad } = parse(text);
  for (const b of bad) console.log("SKIPPED    " + b);
  if (rows.length === 0) {
    console.log("Nothing to import.");
    return;
  }

  const users = await prisma.user.findMany({
    where: { employeeCode: { in: rows.map((r) => r.code) } },
    select: {
      id: true, employeeCode: true, firstName: true, lastName: true,
      monthlySalary: true, status: true,
    },
  });
  const byCode = new Map(
    users.map((u) => [String(u.employeeCode).toUpperCase(), u])
  );

  let changed = 0, same = 0, missing = 0;

  for (const r of rows) {
    const u = byCode.get(r.code);
    if (!u) {
      console.log("NOT FOUND  " + r.code + "  (line " + r.line + ")");
      missing++;
      continue;
    }

    const current = u.monthlySalary === null ? null : Number(u.monthlySalary);
    const name = [u.firstName, u.lastName].filter(Boolean).join(" ");

    if (current === r.salary) { same++; continue; }

    console.log(
      (APPLY ? "SET        " : "WOULD SET  ") +
      r.code.padEnd(10) +
      name.padEnd(22).slice(0, 22) +
      (current === null ? "none" : String(current)) + "  ->  " + r.salary
    );
    changed++;

    if (APPLY) {
      await prisma.user.update({
        where: { id: u.id },
        data: { monthlySalary: r.salary },
      });
    }
  }

  console.log("");
  console.log(
    "rows " + rows.length + "   changed " + changed +
    "   unchanged " + same + "   not found " + missing +
    "   bad lines " + bad.length
  );
  if (!APPLY) console.log("Dry run - nothing written. Run again with APPLY=1 to save.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());