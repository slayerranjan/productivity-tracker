import { prisma } from "./prisma.js";

// ---------------------------------------------------------------------------
// IN-APP NOTIFICATIONS
// One row per recipient. Posting a notification must never break the action
// that caused it, so failures are logged and swallowed.
// ---------------------------------------------------------------------------

export async function notifyUsers(opts: {
  platformId: string;
  userIds: string[];
  type: string;
  title: string;
  body: string;
  link?: string;
  data?: Record<string, unknown>;
}): Promise<number> {
  const ids = [...new Set(opts.userIds)];
  if (ids.length === 0) return 0;
  try {
    const res = await prisma.notification.createMany({
      data: ids.map((userId) => ({
        platformId: opts.platformId,
        userId,
        type: opts.type,
        title: opts.title.slice(0, 160),
        body: opts.body.slice(0, 600),
        link: opts.link ?? null,
        data: (opts.data ?? undefined) as never,
      })),
    });
    return res.count;
  } catch (e) {
    console.error("[notify] could not save notifications:", e);
    return 0;
  }
}
