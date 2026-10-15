// ===========================================================================
// ROOT — a signpost, not a page.
//
// Someone arriving at "/" either has a token or doesn't. Send them to the
// right place instead of making them choose. router.replace, not push, so
// the back button doesn't bounce them straight back here.
// ===========================================================================

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api";

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(getToken() ? "/dashboard" : "/login");
  }, [router]);

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center">
      <p className="text-sm text-slate-400">Loading…</p>
    </main>
  );
}