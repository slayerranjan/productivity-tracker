import { prisma } from "./prisma.js";
import { emitNotificationChange } from "./realtime.js";

// ---------------------------------------------------------------------------
// IN-APP NOTIFICATIONS
// One row per recipient. Posting a notification must never break the action
// that caused it, so failures are logged and swallowed.
//
// `dedupeKey` names the EVENT ("task:<id>:submitted:2"). The same key can exist once per person, so if the same
// event is reported twice (a double click, a retry, a scheduler running twice) the second copy is silently
// dropped. The database enforces this once migration 20261101100000_notification_dedupe is applied; before that,
// the key is stored but nothing stops a repeat (the code never fails because of it).
//
// After saving, each recipient's private inbox channel is pinged so their bell updates instantly. The ping carries
// no content; the page asks for its own inbox.
// ---------------------------------------------------------------------------

export async function notifyUsers(opts: {
  platformId: string;
  userIds: string[];
  type: string;
  title: string;
  body: string;
  link?: string;
  data?: Record<string, unknown>;
  dedupeKey?: string;
}): Promise<number> {
  const ids = [...new Set(opts.userIds)];
  if (ids.length === 0) return 0;
  try {
    const data = opts.dedupeKey ? { ...(opts.data ?? {}), dedupeKey: opts.dedupeKey } : opts.data;
    const res = await prisma.notification.createMany({
      data: ids.map((userId) => ({
        platformId: opts.platformId,
        userId,
        type: opts.type,
        title: opts.title.slice(0, 160),
        body: opts.body.slice(0, 600),
        link: opts.link ?? null,
        data: (data ?? undefined) as never,
      })),
      skipDuplicates: true, // a repeat of the same event (same dedupeKey, same person) is ignored
    });
    if (res.count > 0) emitNotificationChange(ids);
    return res.count;
  } catch (e) {
    console.error("[notify] could not save notifications:", e);
    return 0;
  }
}
