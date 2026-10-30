import { writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma.js";
import { generateMonth } from "../src/modules/payroll/payroll.generate.js";
import { buildPayslipPdf } from "../src/modules/payroll/payroll.pdf.js";

const Y = Number(process.env.Y ?? 2026);
const M = Number(process.env.M ?? 10);

async function main() {
  const actor = await prisma.user.findFirst({
    where: { role: { in: ["HR", "ADMIN"] }, status: "ACTIVE" },
    select: { id: true, employeeCode: true, platformId: true },
    orderBy: { employeeCode: "asc" },
  });

  if (!actor) {
    console.log("No active HR or ADMIN user found.");
    return;
  }
  console.log("running as " + (actor.employeeCode ?? "-"));

  const r = await generateMonth(actor.id, M, Y);

  if (r.slips.length === 0) {
    console.log("No slips to build. Set a monthlySalary on somebody first.");
    for (const s of r.skipped) {
      console.log("  skipped " + (s.employeeCode ?? "-") + ": " + s.reason);
    }
    return;
  }

    const outDir = process.cwd();

  for (const s of r.slips) {
    const { pdf, fileName } = await buildPayslipPdf(actor.id, s.slipId);
    const out = path.join(outDir, fileName);
    writeFileSync(out, pdf);
    console.log(
      (s.employeeCode ?? "-").padEnd(10) +
        "NET " + String(s.netAmount).padStart(10) +
        "   " + pdf.length + " bytes   ->  " + out
    );
  }

  console.log("");
  console.log("The draft slips were kept so the PDFs stay valid.");
  console.log("Drafts are invisible to employees until HR publishes them.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());