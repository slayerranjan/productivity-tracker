import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env") });
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";

// Bulk import. Matched on employee ID, so re-running updates instead of
// duplicating — import now with gaps, re-run when HR fills them in.
//   npx tsx prisma/import-people.ts people.csv --dry

const TZ = "Asia/Kolkata";
const ROLES = ["EMPLOYEE", "MANAGER", "HR", "ADMIN"];
const problems: string[] = [];

type Row = {
  company: string; name: string; code: string; designation: string;
  team: string; reportsTo: string; role: string; email: string; mobile: string;
};

const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else q = false;
      continue;
    }
    if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function readRows(file: string): Row[] {
  const rows = parseCsv(fs.readFileSync(file, "utf8"));

  // Excel keeps the title rows above the headers, so find the header by
  // content rather than assuming a row number.
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    if (rows[i].some((c) => norm(c).toLowerCase().includes("employee id"))) { h = i; break; }
  }
  if (h < 0) throw new Error('No header row containing "Employee ID"');

  const head = rows[h];
  const col = (...n: string[]) =>
    head.findIndex((x) => n.some((s) => norm(x).toLowerCase().includes(s)));

  const c = {
    company: col("company"), name: col("full name"), code: col("employee id"),
    designation: col("designation"), team: col("team / project", "team/project", "team or"),
    reportsTo: col("reports to"), role: col("system role"),
    email: col("personal email", "work email", "email"), mobile: col("mobile"),
  };
  if (c.company < 0 || c.name < 0 || c.code < 0) {
    throw new Error("CSV is missing Company, Full name or Employee ID");
  }

  const out: Row[] = [];
  const seen = new Set<string>();

  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    const g = (idx: number) => (idx >= 0 ? norm(r[idx]) : "");
    const company = g(c.company), name = g(c.name), code = g(c.code);

    if (!company || !name || !code) continue;
    if (/^company$/i.test(company)) continue;
    if (/example row/i.test(r.join(" "))) continue;

    if (seen.has(code.toLowerCase())) {
      problems.push(`Duplicate employee ID "${code}" (${name}) - skipped`);
      continue;
    }
    seen.add(code.toLowerCase());

    const role = g(c.role).toUpperCase();
    out.push({
      company, name, code,
      designation: g(c.designation), team: g(c.team), reportsTo: g(c.reportsTo),
      role: ROLES.includes(role) ? role : "EMPLOYEE",
      email: g(c.email).toLowerCase(), mobile: g(c.mobile),
    });
  }
  return out;
}

// No l/1/O/0 — these get read off a printout and typed on a phone.
function tempPassword() {
  const a = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return Array.from({ length: 9 }, () => a[Math.floor(Math.random() * a.length)]).join("");
}

const slugify = (s: string) =>
  norm(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function main() {
  const file = process.argv[2];
  const dry = process.argv.includes("--dry");
  if (!file) { console.log("Usage: npx tsx prisma/import-people.ts <file.csv> [--dry]"); return; }

  const full = path.resolve(file);
  if (!fs.existsSync(full)) { console.log(`File not found: ${full}`); return; }

  const people = readRows(full);
  const companies = [...new Set(people.map((p) => p.company))];
  const teamKeys = [...new Set(people.filter((p) => p.team).map((p) => `${p.company}||${p.team}`))];

  console.log("");
  console.log("=".repeat(60));
  console.log(dry ? "DRY RUN - nothing written" : "IMPORTING");
  console.log("=".repeat(60));
  console.log(`People            : ${people.length}`);
  console.log(`Companies         : ${companies.length}`);
  console.log(`Projects          : ${teamKeys.length}`);
  console.log(`With a manager    : ${people.filter((p) => p.reportsTo).length}`);
  console.log(`WITHOUT a manager : ${people.filter((p) => !p.reportsTo).length}`);
  console.log("");
  for (const r of ROLES) {
    const n = people.filter((p) => p.role === r).length;
    if (n) console.log(`  ${r.padEnd(9)} ${n}`);
  }
  console.log("");
  for (const co of companies) {
    console.log(`  ${co.padEnd(28)} ${String(people.filter((p) => p.company === co).length).padStart(3)}`);
  }
  if (problems.length) {
    console.log("\nPROBLEMS:");
    problems.forEach((m) => console.log(`  - ${m}`));
  }
  if (dry) { console.log("\nRe-run without --dry to write."); return; }

  // --- companies
  const platformId = new Map<string, string>();
  for (const name of companies) {
    const found = await prisma.platform.findFirst({ where: { name } });
    if (found) { platformId.set(name, found.id); continue; }
    const prefix = (people.find((p) => p.company === name)?.code.match(/^([A-Za-z]+)/)?.[1] ?? "").toUpperCase();
    const made = await prisma.platform.create({
      data: { name, slug: slugify(name), timezone: TZ, employeeCodePrefix: prefix || null },
    });
    platformId.set(name, made.id);
    console.log(`  + company ${name}`);
  }

  // --- people (no reporting line yet: a manager can appear lower in the file)
  const idByCode = new Map<string, string>();
  const creds: string[][] = [];

  for (const p of people) {
    const pid = platformId.get(p.company);
    if (!pid) continue;

    const parts = p.name.split(" ");
    const first = parts[0] ?? p.name;
    const last = parts.slice(1).join(" ");

    const found = await prisma.user.findFirst({
      where: { employeeCode: { equals: p.code, mode: "insensitive" } },
    });

    if (found) {
      await prisma.user.update({
        where: { id: found.id },
        data: {
          platformId: pid, firstName: first, lastName: last,
          designation: p.designation || null, phone: p.mobile || null,
          role: p.role as never,
          ...(p.email ? { email: p.email } : {}),
        },
      });
      idByCode.set(p.code.toLowerCase(), found.id);
      continue;
    }

    // Nobody has a work email, so one is synthesised to fill the column.
    // They sign in with their employee ID; this address is never used.
    const password = tempPassword();
    const made = await prisma.user.create({
      data: {
        platformId: pid,
        employeeCode: p.code,
        email: p.email || `${p.code.toLowerCase()}@${slugify(p.company)}.local`,
        firstName: first, lastName: last,
        designation: p.designation || null, phone: p.mobile || null,
        role: p.role as never,
        status: "ACTIVE" as never,
        passwordHash: await bcrypt.hash(password, 10),
        mustChangePassword: true,
        trackerAccessEnabled: true,
      },
    });
    idByCode.set(p.code.toLowerCase(), made.id);
    creds.push([p.company, p.name, p.code, password]);
  }

  // --- projects. The manager is whoever its members report to.
  const teamId = new Map<string, string>();
  for (const key of teamKeys) {
    const [co, name] = key.split("||");
    const pid = platformId.get(co);
    if (!pid) continue;

    const mCode = people.find((p) => p.company === co && p.team === name && p.reportsTo)?.reportsTo ?? "";
    const managerId = mCode ? idByCode.get(mCode.toLowerCase()) ?? null : null;

    const found = await prisma.team.findFirst({ where: { platformId: pid, name } });
    if (found) {
      teamId.set(key, found.id);
      if (managerId && !found.managerId) {
        await prisma.team.update({ where: { id: found.id }, data: { managerId } });
      }
      continue;
    }
    const made = await prisma.team.create({
      data: { platformId: pid, name, managerId, isActive: true },
    });
    teamId.set(key, made.id);
    console.log(`  + project ${co} / ${name}`);
  }

  // --- reporting lines and memberships
  let linked = 0, orphans = 0, joined = 0;

  for (const p of people) {
    const uid = idByCode.get(p.code.toLowerCase());
    if (!uid) continue;

    if (p.reportsTo) {
      const mid = idByCode.get(p.reportsTo.toLowerCase());
      if (mid && mid !== uid) {
        await prisma.user.update({ where: { id: uid }, data: { reportsToId: mid } });
        linked++;
      } else {
        problems.push(`${p.name} (${p.code}): manager "${p.reportsTo}" not in the file`);
        orphans++;
      }
    } else orphans++;

    const tid = p.team ? teamId.get(`${p.company}||${p.team}`) : undefined;
    if (tid) {
      const m = await prisma.teamMember.findFirst({ where: { teamId: tid, userId: uid } });
      if (m) await prisma.teamMember.update({ where: { id: m.id }, data: { isActive: true } });
      else await prisma.teamMember.create({ data: { teamId: tid, userId: uid } });
      joined++;
    }
  }

  if (creds.length) {
    const out = path.resolve("import-credentials.csv");
    fs.writeFileSync(
      out,
      ["Company,Full name,Employee ID,Login with,Temporary password",
        ...creds.map((c) => `"${c[0]}","${c[1]}","${c[2]}","${c[2]}","${c[3]}"`)].join("\r\n"),
      "utf8"
    );
    console.log(`\nCredential sheet: ${out}`);
    console.log("Hand them out, then delete the file. Everyone is forced to change their password at first login.");
  }

  console.log("");
  console.log("=".repeat(60));
  console.log(`Created   : ${creds.length}`);
  console.log(`Updated   : ${people.length - creds.length}`);
  console.log(`Linked    : ${linked}`);
  console.log(`No manager: ${orphans}`);
  console.log(`In projects: ${joined}`);
  console.log("=".repeat(60));

  if (problems.length) {
    console.log("\nNEEDS ATTENTION:");
    problems.forEach((m) => console.log(`  - ${m}`));
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });