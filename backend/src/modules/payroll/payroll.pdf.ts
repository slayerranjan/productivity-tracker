// The payslip document. Built fresh on every request rather than stored, so
// it always matches the figures in the database - a slip corrected on Tuesday
// can never be downloaded as Monday's version. Nothing is written to storage,
// so there is nothing to grow, expire or go stale.

import PDFDocument from "pdfkit";
import { prisma } from "../../lib/prisma.js";
import { viewerIsOwner } from "../../lib/owner.js";
import { getMonthAttendance } from "../attendance/attendance.service.js";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const round2 = (n: number) => Math.round(n * 100) / 100;

// Indian digit grouping: 12,064.52 and 1,22,064.52, not 122,064.52.
function inr(n: number): string {
  const fixed = Math.abs(n).toFixed(2);
  const [whole, dec] = fixed.split(".");
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest
    ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3
    : last3;
  return `${n < 0 ? "-" : ""}${grouped}.${dec}`;
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty",
  "Ninety",
];

function under100(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return TENS[t] + (o ? ` ${ONES[o]}` : "");
}

function under1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h === 0) return under100(r);
  return `${ONES[h]} Hundred${r ? ` and ${under100(r)}` : ""}`;
}

// A payslip is a financial document, so the figure is written out as well as
// printed. A tampered digit is obvious when the words disagree with it.
function amountInWords(amount: number): string {
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);

  if (rupees === 0 && paise === 0) return "Zero Rupees only";

  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const rest = rupees % 1000;

  const parts: string[] = [];
  if (crore) parts.push(`${under1000(crore)} Crore`);
  if (lakh) parts.push(`${under1000(lakh)} Lakh`);
  if (thousand) parts.push(`${under1000(thousand)} Thousand`);
  if (rest) parts.push(under1000(rest));

  let words = parts.join(" ") + " Rupees";
  if (paise) words += ` and ${under100(paise)} Paise`;
  return words + " only";
}

export type PayslipAccess = { pdf: Buffer; fileName: string };

/**
 * Build one payslip as a PDF.
 *
 * Access is decided here, not by the route, because a payslip is the most
 * sensitive document in the system: the owner may read their own once it is
 * published, and HR or an owner may read any in their company.
 */
export async function buildPayslipPdf(
  actorId: string,
  slipId: string,
): Promise<PayslipAccess> {
  const slip = await prisma.salarySlip.findUnique({
    where: { id: slipId },
    select: {
      id: true, platformId: true, userId: true, month: true, year: true,
      grossAmount: true, deductions: true, netAmount: true,
      daysInMonth: true, payableDays: true, absentDays: true,
      perDayRate: true, lossOfPay: true,
      otherDeduction: true, otherDeductionNote: true,
      status: true, generatedAt: true, approvedAt: true, publishedAt: true,
      user: {
        select: {
          firstName: true, lastName: true, employeeCode: true,
          designation: true, dateOfJoining: true,
        },
      },
      platform: { select: { name: true, timezone: true } },
    },
  });
  if (!slip) throw new Error("SLIP_NOT_FOUND");

  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { platformId: true, role: true },
  });
  if (!actor) throw new Error("USER_NOT_FOUND");

  const isSelf = slip.userId === actorId;
  const isHr = actor.role === "HR" || actor.role === "ADMIN";
  const sameCompany = actor.platformId === slip.platformId;
  const isOwner = await viewerIsOwner(actorId);

  if (isSelf) {
    // An employee may not read a figure HR has not released yet.
    if (!slip.publishedAt) throw new Error("NOT_PUBLISHED");
  } else if (!((isHr && sameCompany) || isOwner)) {
    throw new Error("NOT_ALLOWED");
  }

  const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

  const gross = num(slip.grossAmount);
  const lossOfPay = num(slip.lossOfPay);
  const otherDeduction = num(slip.otherDeduction);
  const deductions = num(slip.deductions);
  const net = num(slip.netAmount);
  const perDay = num(slip.perDayRate);
  const payableDays = num(slip.payableDays);
  const attendance = await getMonthAttendance(slip.userId, slip.year, slip.month);
  // A draft with no stored figures still needs a real month length.
  const daysInMonth = slip.daysInMonth || attendance.totals.daysInMonth;

  const name =
    [slip.user.firstName, slip.user.lastName].filter(Boolean).join(" ").trim() ||
    "Unnamed";
  const monthLabel = `${MONTHS[slip.month - 1]} ${slip.year}`;

  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks))),
  );

  const LEFT = 48;
  const RIGHT = 547; // A4 width 595 less the right margin
  const MID = 297; // the vertical centre line of the content area
  const INK = "#0f172a";
  const MUTED = "#64748b";
  const LINE = "#cbd5e1";
  const TINT = "#f1f5f9";

  // Helvetica has no rupee glyph, so "Rs." is used throughout. A missing
  // glyph prints as a black box on a document somebody takes to a bank.
  const money = (n: number) => `Rs. ${inr(n)}`;
  const dayCount = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  // The day printed on the slip is the company's day, not the server's.
  const dayIn = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: slip.platform.timezone, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(d);

  function rule(y: number) {
    doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(0.5).strokeColor(LINE).stroke();
  }

  function heading(text: string, y: number) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED);
    doc.text(text.toUpperCase(), LEFT, y, { characterSpacing: 0.6 });
  }

  // One label/value pair inside a column that starts at x and is w wide.
  function pair(label: string, value: string, x: number, w: number, y: number, bold = false) {
    doc.font("Helvetica").fontSize(9.5).fillColor(MUTED);
    doc.text(label, x, y, { width: w * 0.55 });
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(INK);
    doc.text(value, x + w * 0.45, y, { width: w * 0.55, align: "right" });
  }

  // --- header
  doc.font("Helvetica-Bold").fontSize(18).fillColor(INK);
  doc.text(slip.platform.name, LEFT, 48);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(INK);
  doc.text("PAYSLIP", RIGHT - 200, 50, { width: 200, align: "right" });
  doc.font("Helvetica").fontSize(10).fillColor(MUTED);
  doc.text(monthLabel, RIGHT - 200, 66, { width: 200, align: "right" });
  if (slip.status !== "APPROVED") {
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#b91c1c");
    doc.text(`${slip.status} - NOT APPROVED`, RIGHT - 200, 82, {
      width: 200, align: "right",
    });
  }
  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  doc.text(`Pay period: 1 - ${daysInMonth} ${monthLabel}`, LEFT, 72);
  rule(100);

  // --- employee details, two columns
  const colW = 230;
  const colR = MID + 20;
  let y = 114;
  heading("Employee", y);
  y += 18;
  pair("Name", name, LEFT, colW, y);
  pair("Date of joining",
    slip.user.dateOfJoining ? dayIn(slip.user.dateOfJoining) : "-", colR, colW, y);
  y += 16;
  pair("Employee code", slip.user.employeeCode ?? "-", LEFT, colW, y);
  pair("Days in month", String(daysInMonth), colR, colW, y);
  y += 16;
  pair("Designation", slip.user.designation ?? "-", LEFT, colW, y);
  pair("Payable days", dayCount(payableDays), colR, colW, y, true);
  y += 26;
  rule(y); y += 14;

  // --- attendance. Every day of the month lands in exactly one line, so the
  // lines add up to "Days in month". Days before joining are unpaid but are
  // not absences, and used to be missing, which made the table not reconcile.
  const t = attendance.totals;
  const upcoming = attendance.days.filter((d) => d.status === "FUTURE").length;
  heading("Attendance", y);
  y += 18;
  const left: [string, string][] = [
    ["Present", dayCount(t.presentDays)],
    ["Half days", dayCount(t.halfDays)],
    ["Leave", dayCount(t.leaveDays)],
    ["Holidays and week-offs", dayCount(t.holidays + t.weekOffs)],
  ];
  const right: [string, string][] = [
    ["Absent / half-day loss", dayCount(t.lossOfPayDays)],
    ["Before joining", dayCount(t.notEmployedDays)],
    ["Not tracked", dayCount(t.notTrackedDays)],
    ["Rest of month", dayCount(upcoming)],
  ];
  for (let i = 0; i < left.length; i++) {
    pair(left[i][0], left[i][1], LEFT, colW, y);
    pair(right[i][0], right[i][1], colR, colW, y);
    y += 16;
  }
  y += 10;
  rule(y); y += 14;

  // --- earnings and deductions, side by side
  const unpaidDays = Math.max(0, round2(daysInMonth - payableDays));
  heading("Earnings", y);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED);
  doc.text("DEDUCTIONS", colR, y, { characterSpacing: 0.6 });
  y += 18;

  const earnTop = y;
  pair("Monthly salary", money(gross), LEFT, colW, y);
  const deductRows: [string, string][] = [
    [`Loss of pay (${dayCount(unpaidDays)} day${unpaidDays === 1 ? "" : "s"})`, money(lossOfPay)],
  ];
  if (otherDeduction > 0) {
    deductRows.push([
      `Other${slip.otherDeductionNote ? ` (${slip.otherDeductionNote})` : ""}`,
      money(otherDeduction),
    ]);
  }
  let dy = earnTop;
  for (const [label, value] of deductRows) {
    pair(label, value, colR, colW, dy);
    dy += 16;
  }
  y = Math.max(earnTop + 16, dy) + 6;

  // Totals row on a tinted band so the two sums are easy to find.
  doc.rect(LEFT, y - 4, RIGHT - LEFT, 22).fill(TINT);
  pair("Gross earnings", money(gross), LEFT + 4, colW - 8, y + 2, true);
  pair("Total deductions", money(deductions), colR, colW - 4, y + 2, true);
  y += 34;

  // --- net payable
  doc.rect(LEFT, y, RIGHT - LEFT, 44).lineWidth(1).strokeColor(INK).stroke();
  doc.font("Helvetica-Bold").fontSize(12).fillColor(INK);
  doc.text("Net payable", LEFT + 12, y + 8);
  doc.fontSize(14);
  doc.text(money(net), RIGHT - 212, y + 7, { width: 200, align: "right" });
  doc.font("Helvetica-Oblique").fontSize(9).fillColor(MUTED);
  doc.text(amountInWords(net), LEFT + 12, y + 28, { width: RIGHT - LEFT - 24 });
  y += 62;

  // --- how it was worked out
  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
  doc.text(
    `Per day rate = monthly salary / ${daysInMonth} days = ${money(perDay)}. ` +
      `Loss of pay = ${dayCount(unpaidDays)} unpaid day${unpaidDays === 1 ? "" : "s"} ` +
      `(${daysInMonth} days in month less ${dayCount(payableDays)} payable days).`,
    LEFT, y, { width: RIGHT - LEFT },
  );
  y += 40;
  rule(y); y += 10;

  // --- footer
  doc.font("Helvetica").fontSize(8).fillColor(MUTED);
  doc.text(
    `Generated ${dayIn(new Date())}. ` +
      (slip.approvedAt
        ? `Approved ${dayIn(slip.approvedAt)}. `
        : "Not yet approved. ") +
      "No PF, PT or ESI is deducted. This is a computer-generated document and does not need a signature.",
    LEFT, y, { width: RIGHT - LEFT },
  );

  doc.end();
  const pdf = await finished;

  const safeCode = (slip.user.employeeCode ?? "employee").replace(/[^A-Za-z0-9-]/g, "");
  const fileName = `payslip-${safeCode}-${slip.year}-${String(slip.month).padStart(2, "0")}.pdf`;

  return { pdf, fileName };
}