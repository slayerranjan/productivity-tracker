import { sendOnboardingReminders } from "../src/modules/onboarding/onboarding.reminders.js";
import { prisma } from "../src/lib/prisma.js";
const n = await sendOnboardingReminders({ force: true });
console.log("reminders processed:", n);
await prisma.$disconnect();
