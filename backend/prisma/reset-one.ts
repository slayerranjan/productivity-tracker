import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";

const CODE = process.env.CODE ?? "";
const PASS = process.env.PASS ?? "";

async function main() {
  if (!CODE || !PASS) {
    console.log('Set CODE and PASS first. Example:');
    console.log('  $env:CODE="TCS-03"; $env:PASS="YourNewPass@123"; npx tsx prisma\\reset-one.ts');
    return;
  }
  if (PASS.length < 8) {
    console.log("Password must be at least 8 characters.");
    return;
  }

  const user = await prisma.user.findFirst({
    where: { employeeCode: CODE },
    select: { id: true, firstName: true, lastName: true, email: true },
  });

  if (!user) {
    console.log("No user with employee code " + CODE);
    return;
  }

  // bcrypt records its own cost inside the hash, so this stays compatible
  // with whatever the app used when the account was created.
  const hash = await bcrypt.hash(PASS, 10);

  await prisma.user.update({
    where: { id: user.id },
    // Not forcing another change: this is a deliberate reset by the owner,
    // not a password somebody else chose for them.
    data: { passwordHash: hash, mustChangePassword: false },
  });

  console.log(
    "Password reset for " + CODE + " — " +
    user.firstName + " " + user.lastName + " — sign in with: " + user.email
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());