import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../lib/prisma.js";

export async function login(email: string, password: string) {
  const user = await prisma.user.findFirst({
    where: { email: email.toLowerCase().trim() },
    include: { platform: true },
  });

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
    platform: {
      id: user.platform.id,
      name: user.platform.name,
      slug: user.platform.slug,
    },
  };
}   