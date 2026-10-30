// Word -> readable HTML for policies. Needs NO database.
//   cd backend && DATABASE_URL=dummy npx tsx tests/policy-docs.test.mts "C:/path/to/policy.docx"
// (The path is optional; without it only the sanitizer checks run.)
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sanitizeHtml, docxToHtml, viewKind } from "../src/modules/policies/policies.docs.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x?: unknown) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + JSON.stringify(x)?.slice(0, 200))); };

// --- sanitizer: nothing executable survives ---------------------------------------------------------
const evil: [string, string][] = [
  ["script tag", `<p>hi</p><script>alert(1)</script>`],
  ["img onerror", `<img src=x onerror=alert(1)>`],
  ["javascript: link", `<a href="javascript:alert(1)">click</a>`],
  ["data: link", `<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>`],
  ["onclick attribute", `<p onclick="alert(1)">x</p>`],
  ["svg onload", `<svg/onload=alert(1)><p>x</p>`],
  ["iframe", `<iframe src="https://evil.example"></iframe>`],
  ["style tag", `<style>body{display:none}</style><p>x</p>`],
  ["nested script split", `<scr<script>ipt>alert(1)</scr</script>ipt>`],
  ["uppercase tags", `<SCRIPT>alert(1)</SCRIPT><IMG SRC=x ONERROR=alert(1)>`],
  ["stray angle bracket", `<p>1 < 2 and <b>bold</b></p>`],
];
for (const [name, html] of evil) {
  const out = sanitizeHtml(html);
  const dangerous = /<\s*(script|img|iframe|svg|style|object|embed)\b/i.test(out) || /\son\w+\s*=/i.test(out) || /href\s*=\s*["']?\s*(javascript|data):/i.test(out);
  ok(`sanitizer: ${name} is neutralised`, !dangerous, out);
}
ok("sanitizer keeps ordinary text and structure", sanitizeHtml(`<h2>Title</h2><p>One <strong>two</strong></p><ul><li>a</li></ul>`) === `<h2>Title</h2><p>One <strong>two</strong></p><ul><li>a</li></ul>`);
ok("sanitizer keeps a safe https link, opened safely", /<a href="https:\/\/example\.com\/x" target="_blank" rel="noopener noreferrer">/.test(sanitizeHtml(`<a href="https://example.com/x" onclick="x()">l</a>`)));
ok("viewKind recognises pdf, docx, image and old doc", viewKind("application/pdf", "a.pdf") === "pdf" && viewKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx") === "docx" && viewKind("image/png", "a.png") === "image" && viewKind("application/msword", "a.doc") === "other");

// --- the real document: the wording must survive unchanged -------------------------------------------------
const file = process.argv[2];
if (file) {
  const buffer = readFileSync(file);
  // The paragraphs exactly as Word stores them, read straight from the file (independent of mammoth).
  const dir = mkdtempSync(path.join(tmpdir(), "docx-"));
  writeFileSync(path.join(dir, "p.docx"), buffer);
  execSync(`unzip -q -o "${path.join(dir, "p.docx")}" word/document.xml -d "${dir}"`);
  let xml = readFileSync(path.join(dir, "word/document.xml"), "utf8");
  rmSync(dir, { recursive: true, force: true });
  const entities = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  const paragraphs = xml.replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, " ").replace(/<[^>]+>/g, "").split("\n").map((l) => entities(l).replace(/\s+/g, " ").trim()).filter(Boolean);

  const view = await docxToHtml(buffer);
  const plain = entities(view.html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
  const squash = (s: string) => s.replace(/\s+/g, "");
  const missing = paragraphs.filter((p) => !squash(plain).includes(squash(p)));
  ok(`all ${paragraphs.length} paragraphs of the document appear in the readable version, word for word`, missing.length === 0, missing.slice(0, 3));
  ok("the readable version contains nothing executable", !/<\s*(script|img|iframe|svg)\b/i.test(view.html) && !/\son\w+\s*=/i.test(view.html));
  ok("headings were recognised as structure (not one blob of text)", /<h\d|<strong>/.test(view.html) && (view.html.match(/<p>/g)?.length ?? 0) > 20, view.html.slice(0, 200));
  const again = await docxToHtml(buffer, "same-key");
  const cached = await docxToHtml(buffer, "same-key");
  ok("converting twice with the same key gives the same result (cached)", again.html === cached.html);
  console.log(`   (${paragraphs.length} paragraphs, ${view.html.length} characters of HTML, ${view.warnings} converter notes)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
