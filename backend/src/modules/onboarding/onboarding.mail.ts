import { prisma } from "../../lib/prisma.js";
import { sendMail } from "../../lib/mailer.js";
import { welcomeEmail } from "../../lib/emails.js";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

const dmy = (d: Date | null) =>
  d
    ? d.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : "to be confirmed";

// ---------------------------------------------------------------------------
// The welcome email, sent when HR creates a joiner.
//
// Deliberately NEVER throws. HR creating a person must succeed even if the
// mailbox is misconfigured — the result says what happened so the screen can
// show HR the password to pass on by hand instead.
// ---------------------------------------------------------------------------
export async function sendWelcome(userId: string, temporaryPassword: string) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { platform: true },
    });
    if (!user) return { sent: false, reason: "USER_NOT_FOUND", to: null };

    // The bulk import invents addresses like awl-02@aayush-wellness.local to
    // fill a required column. Those can't receive mail.
    if (!user.email || user.email.endsWith(".local")) {
      return { sent: false, reason: "NO_REAL_EMAIL", to: user.email ?? null };
    }

    const requirements = await prisma.documentRequirement.findMany({
      where: {
        platformId: user.platformId,
        isActive: true,
        uploadedByEmployee: true,
      },
      orderBy: { sortOrder: "asc" },
      select: { label: true, isMandatory: true },
    });

    const mail = welcomeEmail({
      firstName: user.firstName,
      company: user.platform.name,
      roleTitle: user.designation ?? "your new role",
      joiningDate: dmy(user.dateOfJoining),
      reportingTo: null,
      loginEmail: user.email,
      temporaryPassword,
      setPasswordUrl: `${APP_URL}/login`,
      documents: requirements.map(
        (r) => `${r.label}${r.isMandatory ? "" : " (optional)"}`
      ),
      intro: null,
    });

    const result = await sendMail({
      to: user.email,
      subject: mail.subject,
      html: mail.html,
    });

    return { sent: result.sent, reason: result.reason ?? null, to: user.email };
  } catch (err) {
    console.error("[onboarding mail] failed:", err);
    return {
      sent: false,
      reason: err instanceof Error ? err.message : "FAILED",
      to: null,
    };
  }
}