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
      platform: { select: { name: true } },
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
  const absentDays = num(slip.absentDays);
  const daysInMonth = slip.daysInMonth ?? 0;

  const attendance = await getMonthAttendance(slip.userId, slip.year, slip.month);

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
  const INK = "#0f172a";
  const MUTED = "#64748b";
  const LINE = "#cbd5e1";

  // Helvetica has no rupee glyph, so "Rs." is used throughout. A missing
  // glyph prints as a black box on a document somebody takes to a bank.
  const money = (n: number) => `Rs. ${inr(n)}`;

  function rule(y: number) {
    doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(0.5).strokeColor(LINE).stroke();
  }

  function row(label: string, value: string, y: number, bold = false) {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(INK);
    doc.text(label, LEFT + 6, y, { width: 300 });
    doc.text(value, RIGHT - 206, y, { width: 200, align: "right" });
  }

  // --- header
  doc.font("Helvetica-Bold").fontSize(16).fillColor(INK);
  doc.text(slip.platform.name, LEFT, 48);
  doc.font("Helvetica").fontSize(10).fillColor(MUTED);
  doc.text(`Salary slip for ${monthLabel}`, LEFT, 70);

  if (slip.status !== "APPROVED") {
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#b91c1c");
    doc.text(`${slip.status} - NOT APPROVED`, RIGHT - 200, 50, {
      width: 200, align: "right",
    });
  }
  rule(92);

  // --- employee
  let y = 106;
  doc.font("Helvetica-Bold").fontSize(11).fillColor(INK);
  doc.text("Employee", LEFT, y);
  y += 20;
  row("Name", name, y); y += 18;
  row("Employee code", slip.user.employeeCode ?? "-", y); y += 18;
  row("Designation", slip.user.designation ?? "-", y); y += 18;
  row(
    "Date of joining",
    slip.user.dateOfJoining
      ? slip.user.dateOfJoining.toISOString().slice(0, 10)
      : "-",
    y,
  );
  y += 28;
  rule(y); y += 14;

  // --- attendance
  doc.font("Helvetica-Bold").fontSize(11).fillColor(INK);
  doc.text("Attendance", LEFT, y);
  y += 20;
  row("Days in month", String(daysInMonth), y); y += 18;
  row("Present", String(attendance.totals.presentDays), y); y += 18;
  row("Half days", String(attendance.totals.halfDays), y); y += 18;
  row("Leave", String(attendance.totals.leaveDays), y); y += 18;
  row("Holidays and week-offs",
    String(attendance.totals.holidays + attendance.totals.weekOffs), y); y += 18;
  row("Absent (loss of pay)", String(absentDays), y); y += 18;
  row("Payable days", String(payableDays), y, true);
  y += 28;
  rule(y); y += 14;

  // --- money
  doc.font("Helvetica-Bold").fontSize(11).fillColor(INK);
  doc.text("Calculation", LEFT, y);
  y += 20;
  row("Monthly salary", money(gross), y); y += 18;
  row(`Per day (salary / ${daysInMonth} days)`, money(perDay), y); y += 18;
  row("Loss of pay", `- ${money(lossOfPay)}`, y); y += 18;
  if (otherDeduction > 0) {
    row(
      `Other deduction${slip.otherDeductionNote ? ` (${slip.otherDeductionNote})` : ""}`,
      `- ${money(otherDeduction)}`,
      y,
    );
    y += 18;
  }
  row("Total deductions", `- ${money(deductions)}`, y); y += 24;

  rule(y); y += 10;
  doc.font("Helvetica-Bold").fontSize(13).fillColor(INK);
  doc.text("Net payable", LEFT + 6, y);
  doc.text(money(net), RIGHT - 206, y, { width: 200, align: "right" });
  y += 24;
  doc.font("Helvetica-Oblique").fontSize(9).fillColor(MUTED);
  doc.text(amountInWords(net), LEFT + 6, y, { width: RIGHT - LEFT - 12 });
  y += 30;
  rule(y); y += 12;

  // --- footer
  doc.font("Helvetica").fontSize(8).fillColor(MUTED);
  doc.text(
    `Generated ${new Date().toISOString().slice(0, 10)}. ` +
      (slip.approvedAt
        ? `Approved ${slip.approvedAt.toISOString().slice(0, 10)}. `
        : "Not yet approved. ") +
      "No PF, PT or ESI is deducted. This is a computer-generated document.",
    LEFT, y, { width: RIGHT - LEFT },
  );

  doc.end();
  const pdf = await finished;

  const safeCode = (slip.user.employeeCode ?? "employee").replace(/[^A-Za-z0-9-]/g, "");
  const fileName = `payslip-${safeCode}-${slip.year}-${String(slip.month).padStart(2, "0")}.pdf`;

  return { pdf, fileName };
}