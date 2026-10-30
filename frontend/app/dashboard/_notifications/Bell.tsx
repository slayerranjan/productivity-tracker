"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";

// ---------------------------------------------------------------------------
// NOTIFICATION BELL
// The signed-in person's own inbox. The count refreshes every 30 seconds and
// whenever the window regains focus, so a new request shows up without a reload.
// ---------------------------------------------------------------------------

type Item = { id: string; type: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string };
type Inbox = { unread: number; items: Item[] };

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};

export default function Bell() {
  const router = useRouter();
  const [inbox, setInbox] = useState<Inbox>({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; wide: boolean }>({ top: 64, left: 16, wide: true });
  const button = useRef<HTMLButtonElement>(null);

  const load = useCallback(() => {
    apiGet<Inbox>("/notifications")
      .then(setInbox)
      .catch(() => undefined); // a failed refresh keeps the last inbox instead of showing an error
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  function toggle() {
    if (!open && button.current) {
      const r = button.current.getBoundingClientRect();
      const wide = window.innerWidth < 768;
      setPos({ top: wide ? r.bottom + 8 : Math.max(12, r.top), left: wide ? 16 : r.right + 12, wide });
      load();
    }
    setOpen((o) => !o);
  }

  async function openItem(i: Item) {
    setOpen(false);
    if (!i.readAt) {
      await apiPost(`/notifications/${i.id}/read`).catch(() => undefined);
      load();
    }
    if (i.link) router.push(i.link);
  }

  async function readAll() {
    await apiPost("/notifications/read-all").catch(() => undefined);
    load();
  }

  return (
    <>
      <button ref={button} onClick={toggle} aria-label={`Notifications${inbox.unread ? `, ${inbox.unread} unread` : ""}`} className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
        <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 2.8a4.7 4.7 0 0 0-4.7 4.7c0 4.4-1.8 5.6-1.8 5.6h13s-1.8-1.2-1.8-5.6A4.7 4.7 0 0 0 10 2.8Z" />
          <path d="M8.3 15.8a1.8 1.8 0 0 0 3.4 0" />
        </svg>
        {inbox.unread > 0 && (
          <span data-testid="bell-count" className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {Math.min(99, inbox.unread)}
          </span>
        )}
      </button>

      {open &&
        createPortal(
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="Notifications"
            className="fixed z-[100] max-h-[70vh] overflow-hidden rounded-2xl bg-white shadow-[var(--shadow-lift)] ring-1 ring-indigo-100"
            style={{ top: pos.top, left: pos.left, width: pos.wide ? "calc(100vw - 2rem)" : "24rem" }}
          >
            <div className="flex items-center justify-between border-b border-indigo-100 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">Notifications</p>
              {inbox.unread > 0 && (
                <button onClick={readAll} className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {inbox.items.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-500">You&apos;re all caught up.</p>
              ) : (
                inbox.items.map((i) => (
                  <button key={i.id} onClick={() => openItem(i)} className={`block w-full border-b border-indigo-50 px-4 py-3 text-left hover:bg-indigo-50/50 ${i.readAt ? "" : "bg-indigo-50/40"}`}>
                    <div className="flex items-start gap-2">
                      {!i.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-600" />}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">{i.title}</p>
                        <p className="mt-0.5 line-clamp-3 text-xs text-slate-500">{i.body}</p>
                        <p className="mt-1 text-[11px] text-slate-400">{ago(i.createdAt)}</p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}
