import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

// Who exists, what they log in with, and whether they still owe a password
// change. Passwords are hashed and cannot be printed — reset them instead.
async function main() {
  const users = await prisma.user.findMany({
    include: { platform: { select: { name: true } } },
    orderBy: [{ platform: { name: "asc" } }, { firstName: "asc" }],
  });

  console.table(
    users.map((u) => ({
      login: u.employeeCode ?? u.email,
      name: `${u.firstName} ${u.lastName}`.trim(),
      role: String(u.role),
      company: u.platform?.name ?? "",
      email: u.email,
      mustChange: u.mustChangePassword ? "yes" : "",
      status: String(u.status),
    }))
  );

  console.log(`\n${users.length} accounts total`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });