import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DIRECT_URL must be set in backend/.env");

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding...");

    const platformSeeds = [
    { slug: "avatar", name: "Avatar", legalName: "Avatar India", prefix: "AVT" },
    { slug: "take-health", name: "Take Health", legalName: "Take Health", prefix: "TKH" },
    { slug: "co-lab", name: "Co-Lab", legalName: "Co-Lab", prefix: "CLB" },
  ];

    const platforms = [];
  for (const seed of platformSeeds) {
    platforms.push(
      await prisma.platform.upsert({
        where: { slug: seed.slug },
        update: {
          name: seed.name,
          legalName: seed.legalName,
          employeeCodePrefix: seed.prefix,
        },
        // Listed field by field on purpose. A `...seed` spread would also
        // copy `prefix`, which is the name in this file, not a column in
        // the database — Prisma rejects unknown fields.
        create: {
          slug: seed.slug,
          name: seed.name,
          legalName: seed.legalName,
          employeeCodePrefix: seed.prefix,
          timezone: "Asia/Kolkata",
          country: "IN",
        },
      })
    );
    console.log(`  platform: ${seed.name}`);
  }

  const avatar = platforms[0]!;

  const shift = await prisma.shift.upsert({
    where: { platformId_name: { platformId: avatar.id, name: "General 10-7" } },
    update: {},
    create: {
      platformId: avatar.id,
      name: "General 10-7",
      startTime: "10:00",
      endTime: "19:00",
      workingDays: [1, 2, 3, 4, 5, 6],
      isDefault: true,
    },
  });
  console.log(`  shift: ${shift.name}`);

  const team = await prisma.team.upsert({
    where: { platformId_name: { platformId: avatar.id, name: "Operations" } },
    update: {},
    create: {
      platformId: avatar.id,
      name: "Operations",
      teamType: "OPERATIONS",
      shiftId: shift.id,
    },
  });
  console.log(`  team: ${team.name}`);

  await prisma.teamConfig.upsert({
    where: { teamId: team.id },
    update: {},
    create: {
      teamId: team.id,
      dailyWorkHours: 9,
      productiveHours: 8,
      breakBudgetMinutes: 60,
      lateLoginGraceMinutes: 15,
      overtimeAlertMinutes: 15,
      lowProductivityThreshold: 0.75,
      biometricToleranceMinutes: 10,
      eodReportTime: "19:30",
    },
  });
  console.log("  team config: ready");

  const people = [
    {
      email: "admin@avatarindia.com",
      password: "Admin@12345",
      firstName: "System",
      lastName: "Admin",
      code: "AVT-0001",
      role: "ADMIN" as const,
      designation: "Administrator",
    },
    {
      email: "manager@avatarindia.com",
      password: "Manager@12345",
      firstName: "Neha",
      lastName: "Sharma",
      code: "AVT-0002",
      role: "MANAGER" as const,
      designation: "Operations Manager",
    },
    {
      email: "priya@avatarindia.com",
      password: "Employee@12345",
      firstName: "Priya",
      lastName: "Nair",
      code: "AVT-0003",
      role: "EMPLOYEE" as const,
      designation: "Associate",
    },
    {
      email: "rahul@avatarindia.com",
      password: "Employee@12345",
      firstName: "Rahul",
      lastName: "Verma",
      code: "AVT-0004",
      role: "EMPLOYEE" as const,
      designation: "Associate",
    },
  ];

  let managerId: string | null = null;

  for (const p of people) {
    const passwordHash = await bcrypt.hash(p.password, 10);

    const user = await prisma.user.upsert({
      where: { platformId_email: { platformId: avatar.id, email: p.email } },
      update: { passwordHash, role: p.role, status: "ACTIVE" },
      create: {
        platformId: avatar.id,
        email: p.email,
        passwordHash,
        firstName: p.firstName,
        lastName: p.lastName,
        employeeCode: p.code,
        role: p.role,
        status: "ACTIVE",
        designation: p.designation,
        shiftId: shift.id,
        onboardingStatus: "ACTIVE",
        trackerAccessEnabled: true,
        accessGrantedAt: new Date(),
        dateOfJoining: new Date(),
      },
    });

    if (p.role === "MANAGER") managerId = user.id;

    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: team.id, userId: user.id } },
      update: { isActive: true },
      create: { teamId: team.id, userId: user.id },
    });

    console.log(`  user: ${p.email} (${p.role})`);
  }

  if (managerId) {
    await prisma.team.update({
      where: { id: team.id },
      data: { managerId },
    });
    console.log("  manager assigned to team");
  }

  console.log("\nSeed complete.\n");
  console.log("  admin@avatarindia.com    Admin@12345");
  console.log("  manager@avatarindia.com  Manager@12345");
  console.log("  priya@avatarindia.com    Employee@12345");
  console.log("  rahul@avatarindia.com    Employee@12345");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error("Seed failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });