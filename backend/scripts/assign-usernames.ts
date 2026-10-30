// One-off: give the Avatar India team their login usernames ("firstname_avatar").
//
//   npx tsx scripts/assign-usernames.ts           dry run: prints the mapping and any problem, writes nothing
//   npx tsx scripts/assign-usernames.ts --apply   writes the usernames (and one audit row each)
//
// It ONLY inserts rows into login_usernames. It never changes an employee ID, name, email, designation, team,
// manager or password, and it never creates an employee. Run it only after the migration
// 20261030130000_login_usernames has been applied.
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

const APPLY = process.argv.includes("--apply");

// Employee IDs that get a username. TCS-03 (a second "Ranjan S") is left out until the duplicate is resolved,
// and suspended accounts cannot sign in anyway.
const CODES = ["AI-01", "AI-02", "AI-03", "AI-04", "AI-05", "AI-06", "AI-07", "AI-08", "AI-10"];

const FORMAT = /^[a-z][a-z0-9_]{2,40}$/;

async function main() {
  const people = await prisma.user.findMany({
    where: { employeeCode: { in: CODES } },
    select: { id: true, employeeCode: true, firstName: true, lastName: true, status: true, platformId: true, platform: { select: { slug: true } } },
  });

  const problems: string[] = [];
  const plan: { id: string; platformId: string; code: string; name: string; username: string }[] = [];

  for (const code of CODES) {
    const p = people.find((x) => x.employeeCode === code);
    if (!p) { problems.push(`${code}: no such employee`); continue; }
    if (p.platform.slug !== "avatar-india") { problems.push(`${code}: not in Avatar India (${p.platform.slug})`); continue; }
    if (p.status === "SUSPENDED" || p.status === "EXITED") { problems.push(`${code}: account is ${p.status}`); continue; }
    const first = p.firstName.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "");
    const username = `${first}_avatar`;
    if (!FORMAT.test(username)) { problems.push(`${code}: "${username}" is not a valid username`); continue; }
    plan.push({ id: p.id, platformId: p.platformId, code, name: `${p.firstName} ${p.lastName}`.trim(), username });
  }

  // Unique inside this batch, and not already taken, and never equal to anyone's employee ID.
  const seen = new Map<string, string>();
  for (const x of plan) {
    if (seen.has(x.username)) problems.push(`${x.code}: "${x.username}" is also proposed for ${seen.get(x.username)}`);
    seen.set(x.username, x.code);
  }
  try {
    const taken = await prisma.loginUsername.findMany({ where: { OR: [{ username: { in: plan.map((x) => x.username) } }, { userId: { in: plan.map((x) => x.id) } }] } });
    for (const t of taken) problems.push(`already assigned: ${t.username} (user ${t.userId})`);
  } catch {
    problems.push("the login_usernames table does not exist on this database yet (apply migration 20261030130000_login_usernames first)");
  }
  const codeClash = await prisma.user.findMany({ where: { employeeCode: { in: plan.map((x) => x.username), mode: "insensitive" } }, select: { employeeCode: true } });
  for (const c of codeClash) problems.push(`"${c.employeeCode}" is an employee ID and cannot also be a username`);

  console.log(APPLY ? "MODE: apply" : "MODE: dry run (nothing is written)");
  console.table(plan.map((x) => ({ "Employee ID": x.code, Name: x.name, "Proposed username": x.username })));
  if (problems.length) {
    console.log("PROBLEMS:\n  " + problems.join("\n  "));
    if (APPLY) { console.log("Not applying while there are problems."); process.exitCode = 1; return; }
  }
  if (!APPLY) return;

  await prisma.$transaction(async (tx) => {
    for (const x of plan) {
      await tx.loginUsername.create({ data: { userId: x.id, username: x.username } });
      await tx.auditLog.create({
        data: {
          platformId: x.platformId, actorId: null, method: "SCRIPT", path: "/script/assign-usernames", status: 200,
          module: "Employees", action: "UPDATE", recordType: "LoginUsername", recordId: x.id, targetUserId: x.id,
          summary: `Login username "${x.username}" set for ${x.name} (${x.code})`,
          before: { username: null } as never, after: { username: x.username } as never,
        },
        select: { id: true },
      });
    }
  });
  console.log(`Created ${plan.length} usernames and ${plan.length} audit rows.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
