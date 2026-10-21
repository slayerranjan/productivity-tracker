import nodemailer, { type Transporter } from "nodemailer";

// ---------------------------------------------------------------------------
// MAIL
//
// Generic SMTP, so Google Workspace, Microsoft 365 and Brevo all work by
// changing .env rather than changing code.
//
// With no SMTP configured it does NOT throw — it logs the message to the
// backend terminal and reports success. That means the onboarding flow is
// fully testable before the mailbox is set up, and a mail outage can never
// block HR from creating a joiner.
// ---------------------------------------------------------------------------

type Mail = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

const HOST = process.env.SMTP_HOST ?? "";
const PORT = Number(process.env.SMTP_PORT ?? 587);
const USER = process.env.SMTP_USER ?? "";
const PASS = process.env.SMTP_PASS ?? "";
const FROM =
  process.env.SMTP_FROM ?? (USER ? `Productivity Tracker <${USER}>` : "");

export const mailConfigured = Boolean(HOST && USER && PASS);

let transport: Transporter | null = null;

function getTransport() {
  if (!mailConfigured) return null;
  if (transport) return transport;

  transport = nodemailer.createTransport({
    host: HOST,
    port: PORT,
    // 465 is implicit TLS; 587 upgrades with STARTTLS. Google Workspace and
    // Microsoft 365 both accept 587.
    secure: PORT === 465,
    auth: { user: USER, pass: PASS },
  });

  return transport;
}

// Strips tags for the plain-text part. Some corporate mail clients show only
// text, and a mail with no text part scores worse with spam filters.
function toText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<li>/gi, "  - ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sendMail(mail: Mail): Promise<{
  sent: boolean;
  reason?: string;
}> {
  const text = mail.text ?? toText(mail.html);
  const t = getTransport();

  if (!t) {
    console.log("");
    console.log("-".repeat(66));
    console.log("EMAIL NOT SENT - no SMTP configured. It would have said:");
    console.log("-".repeat(66));
    console.log(`To      : ${mail.to}`);
    console.log(`Subject : ${mail.subject}`);
    console.log("");
    console.log(text);
    console.log("-".repeat(66));
    console.log("");
    return { sent: false, reason: "SMTP_NOT_CONFIGURED" };
  }

  try {
    await t.sendMail({
      from: FROM,
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text,
    });
    return { sent: true };
  } catch (err) {
    // Never let a mail failure roll back the thing that triggered it. HR
    // creating a joiner must succeed even if the mailbox is misconfigured —
    // the result reports what happened so the screen can say so.
    console.error("[mail] send failed:", err);
    return {
      sent: false,
      reason: err instanceof Error ? err.message : "SEND_FAILED",
    };
  }
}