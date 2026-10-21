// ---------------------------------------------------------------------------
// EMAIL TEMPLATES
//
// Inline CSS only — Gmail and Outlook strip <style> blocks. Tables for
// layout for the same reason. Looks dated as code, correct in an inbox.
// ---------------------------------------------------------------------------

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

function shell(heading: string, company: string, inner: string) {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;">
  <tr><td style="background:#0f172a;padding:22px 28px;">
    <p style="margin:0;color:#ffffff;font-size:15px;font-weight:600;">${company}</p>
    <p style="margin:3px 0 0;color:#94a3b8;font-size:12px;">Productivity Tracker</p>
  </td></tr>
  <tr><td style="padding:30px 28px 10px;">
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#0f172a;font-weight:600;">${heading}</h1>
    ${inner}
  </td></tr>
  <tr><td style="padding:18px 28px 26px;border-top:1px solid #e2e8f0;">
    <p style="margin:0;color:#94a3b8;font-size:11px;line-height:1.5;">
      Automated message from ${company}'s Productivity Tracker.
      If you weren't expecting it, please ignore it.
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function button(label: string, href: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;"><tr>
<td style="background:#4f46e5;border-radius:8px;">
  <a href="${href}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">${label}</a>
</td></tr></table>`;
}

const p = (t: string) =>
  `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#334155;">${t}</p>`;

const code = (t: string) =>
  `<code style="font-family:monospace;font-size:14px;background:#e2e8f0;padding:2px 6px;border-radius:4px;">${t}</code>`;

function detailRows(rows: [string, string][]) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#f8fafc;border-radius:10px;">
${rows
  .map(
    ([k, v]) => `<tr>
  <td style="padding:9px 16px;font-size:12px;color:#64748b;width:42%;">${k}</td>
  <td style="padding:9px 16px;font-size:13px;color:#0f172a;font-weight:500;">${v}</td>
</tr>`
  )
  .join("")}
</table>`;
}

// ---------------------------------------------------------------------------
// 1. WELCOME — when HR sends the offer. Carries the role, the joining date,
//    the login, the temporary password and the document list, so the
//    candidate never has to ask HR what happens next.
// ---------------------------------------------------------------------------
export function welcomeEmail(input: {
  firstName: string;
  company: string;
  roleTitle: string;
  joiningDate: string;
  reportingTo?: string | null;
  loginEmail: string;
  temporaryPassword: string;
  setPasswordUrl: string;
  documents: string[];
  intro?: string | null;
}) {
  const docs = input.documents.length
    ? `<p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#0f172a;">Documents to upload</p>
       <ul style="margin:0 0 20px;padding-left:20px;font-size:13px;line-height:1.9;color:#334155;">
       ${input.documents.map((d) => `<li>${d}</li>`).join("")}
       </ul>`
    : "";

  const inner = `
${p(`Hello ${input.firstName},`)}
${p(input.intro ?? `We're glad to have you joining ${input.company}. Here are the details.`)}
${detailRows([
  ["Position", input.roleTitle],
  ["Joining date", input.joiningDate],
  ...(input.reportingTo
    ? ([["Reporting to", input.reportingTo]] as [string, string][])
    : []),
  ["Your login", input.loginEmail],
  ["Temporary password", code(input.temporaryPassword)],
])}
${p("Sign in, read your offer letter, and upload the documents listed. You'll be asked to set your own password the first time — the one above stops working then.")}
${button("Sign in", input.setPasswordUrl)}
${docs}
`;

  return {
    subject: `Welcome to ${input.company} — ${input.roleTitle}`,
    html: shell(`Welcome aboard, ${input.firstName}`, input.company, inner),
  };
}

// ---------------------------------------------------------------------------
// 2. ACTIVATED — once HR has approved everything. Hands over the employee ID
//    and opens the tracker.
// ---------------------------------------------------------------------------
export function activatedEmail(input: {
  firstName: string;
  company: string;
  employeeCode: string | null;
  loginEmail: string;
}) {
  const inner = `
${p(`Hello ${input.firstName},`)}
${p("Your documents have all been verified. Your account is now fully open.")}
${detailRows([
  ...(input.employeeCode
    ? ([["Employee ID", code(input.employeeCode)]] as [string, string][])
    : []),
  [
    "Sign in with",
    input.employeeCode
      ? `${input.employeeCode} or ${input.loginEmail}`
      : input.loginEmail,
  ],
])}
${p("You can now clock in, record breaks, write your daily tasks, and see your offer letter and payslips in your profile.")}
${button("Open the tracker", `${APP_URL}/login`)}
`;

  return {
    subject: `${input.company} — your account is active`,
    html: shell("You're all set", input.company, inner),
  };
}

// ---------------------------------------------------------------------------
// 3. DOCUMENT REJECTED — so the candidate knows exactly what to redo.
//    Without it they wait, assuming HR is still looking.
// ---------------------------------------------------------------------------
export function documentRejectedEmail(input: {
  firstName: string;
  company: string;
  documentName: string;
  reason: string;
}) {
  const inner = `
${p(`Hello ${input.firstName},`)}
${p(`One document needs uploading again: <strong>${input.documentName}</strong>.`)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#fef2f2;border-left:3px solid #ef4444;">
<tr><td style="padding:12px 16px;font-size:13px;line-height:1.6;color:#7f1d1d;">${input.reason}</td></tr>
</table>
${p("Sign in and upload a replacement. Nothing else is affected.")}
${button("Upload again", `${APP_URL}/onboarding`)}
`;

  return {
    subject: `Action needed — ${input.documentName}`,
    html: shell("One document needs redoing", input.company, inner),
  };
}

// ---------------------------------------------------------------------------
// 4. REMINDER — at 24 and 48 hours if documents are still outstanding.
//    Most onboarding delay is the candidate, not HR.
// ---------------------------------------------------------------------------
export function reminderEmail(input: {
  firstName: string;
  company: string;
  pending: string[];
  hoursLeft: number;
}) {
  const inner = `
${p(`Hello ${input.firstName},`)}
${p(`Your account opens as soon as these are in — about <strong>${input.hoursLeft} hours</strong> before HR follows up.`)}
<ul style="margin:0 0 20px;padding-left:20px;font-size:13px;line-height:1.9;color:#334155;">
${input.pending.map((d) => `<li>${d}</li>`).join("")}
</ul>
${button("Upload now", `${APP_URL}/onboarding`)}
`;

  return {
    subject: `Reminder — ${input.pending.length} document${
      input.pending.length === 1 ? "" : "s"
    } still needed`,
    html: shell("Nearly there", input.company, inner),
  };
}