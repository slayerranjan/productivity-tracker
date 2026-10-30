import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../lib/prisma.js";

// ---------------------------------------------------------------------------
// LOGIN BY EMAIL **OR** EMPLOYEE ID
//
// None of the 51 people HR sent us have a work email address. Telecallers
// will not remember an invented one, so the employee ID they already know
// from payroll — AWL-01, Avance-07 — is the identifier they type.
//
// No migration needed: employeeCode already exists on User. What it lacks is
// a unique index, so this resolves defensively and refuses to guess when two
// people share a code rather than letting one sign in as the other.
// ---------------------------------------------------------------------------
async function findByIdentifier(identifier: string) {
  const id = identifier.trim();
  if (!id) return null;

  // An "@" means they typed an email. Anything else is treated as a code.
  if (id.includes("@")) {
    return prisma.user.findFirst({
      where: { email: id.toLowerCase() },
      include: { platform: true },
    });
  }

  const matches = await prisma.user.findMany({
    where: { employeeCode: { equals: id, mode: "insensitive" } },
    include: { platform: true },
    take: 2,
  });

  if (matches.length > 1) throw new Error("DUPLICATE_EMPLOYEE_ID");
  return matches[0] ?? null;
}

export async function login(identifier: string, password: string) {
  const user = await findByIdentifier(identifier);

  if (!user || !user.passwordHash) {
    throw new Error("INVALID_CREDENTIALS");
  }

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) {
    throw new Error("INVALID_CREDENTIALS");
  }

  if (user.status === "SUSPENDED" || user.status === "EXITED") {
    throw new Error("ACCOUNT_INACTIVE");
  }

  const token = jwt.sign(
    { userId: user.id, platformId: user.platformId, role: user.role },
    process.env.JWT_SECRET as string,
    { expiresIn: process.env.JWT_EXPIRES_IN ?? "1d" } as jwt.SignOptions
  );

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return { token, user: publicUser(user) };
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { platform: true },
  });

  return user ? publicUser(user) : null;
}

function publicUser(user: any) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    employeeCode: user.employeeCode,
    role: user.role,
    status: user.status,
    designation: user.designation,
    onboardingStatus: user.onboardingStatus,
    trackerAccessEnabled: user.trackerAccessEnabled,
        // The frontend can't route someone to the change-password screen if it
    // doesn't know they need it.
    mustChangePassword: user.mustChangePassword,
    platform: {
      id: user.platform.id,
      name: user.platform.name,
      slug: user.platform.slug,
      // The frontend reads every date and time in this zone.
      timezone: user.platform.timezone,
    },
  };
}