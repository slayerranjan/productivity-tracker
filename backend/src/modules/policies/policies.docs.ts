// Turns a Word (.docx) policy into readable HTML for the reading page. The ORIGINAL file is never changed and
// stays downloadable; this is only a view of it.
//
// mammoth only emits a small set of tags, but the HTML goes straight into a page, so it is cleaned again here
// anyway (defence in depth): only a fixed list of tags survives, none keeps an attribute except a safe link,
// and any stray "<" is escaped. Images are dropped (a policy is text).

import mammoth from "mammoth";

const ALLOWED = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "strong", "em", "b", "i", "u", "br", "table", "thead", "tbody", "tr", "td", "th", "sup", "sub", "a", "blockquote"];
const ALLOWED_SET = new Set(ALLOWED);

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function sanitizeHtml(input: string): string {
  const out = input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|svg|math|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g, (whole, tag: string, attrs: string) => {
      const t = tag.toLowerCase();
      if (!ALLOWED_SET.has(t)) return "";
      if (whole.startsWith("</")) return `</${t}>`;
      if (t === "br") return "<br>";
      if (t === "a") {
        const href = /href\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? /href\s*=\s*'([^']*)'/i.exec(attrs)?.[1] ?? "";
        const clean = href.trim();
        return /^(https?:\/\/|mailto:)/i.test(clean) ? `<a href="${escapeAttr(clean)}" target="_blank" rel="noopener noreferrer">` : "<a>";
      }
      return `<${t}>`;
    });
  // Whatever "<" is left did not form an allowed tag: show it as text, never as markup.
  return out.replace(new RegExp(`<(?!/?(?:${ALLOWED.join("|")})\\b)`, "g"), "&lt;");
}

export type DocxView = { html: string; warnings: number };

const cache = new Map<string, DocxView>(); // keyed by storage key (immutable), small and bounded

export async function docxToHtml(buffer: Buffer, cacheKey?: string): Promise<DocxView> {
  if (cacheKey && cache.has(cacheKey)) return cache.get(cacheKey)!;
  const result = await mammoth.convertToHtml(
    { buffer },
    { ignoreEmptyParagraphs: true, convertImage: mammoth.images.imgElement(async () => ({ src: "" })) }
  );
  const view = { html: sanitizeHtml(result.value), warnings: result.messages.length };
  if (cacheKey) {
    if (cache.size >= 24) cache.delete(cache.keys().next().value as string);
    cache.set(cacheKey, view);
  }
  return view;
}

// The three ways a stored file can be shown.
export function viewKind(mimeType: string | null | undefined, fileName: string): "docx" | "pdf" | "image" | "other" {
  const m = String(mimeType ?? "").toLowerCase();
  const n = fileName.toLowerCase();
  if (m === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (m.startsWith("image/")) return "image";
  if (m.includes("wordprocessingml") || n.endsWith(".docx")) return "docx";
  return "other"; // old .doc: cannot be shown in the page, only downloaded
}
