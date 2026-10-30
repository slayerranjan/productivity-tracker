import { prisma } from "../../lib/prisma.js";

// A person only ever sees and changes their OWN notifications.

const SELECT = { id: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true } as const;

// The bell: the latest 30 and the unread count (unchanged shape).
export async function listMine(userId: string) {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 30, select: SELECT }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { unread, items };
}

// The notification centre: all or unread only, newest first, a page at a time. `before` is the createdAt of the last
// item already shown, so pages never overlap or skip even while new notifications arrive.
export async function page(userId: string, q: { filter?: string; before?: string; limit?: number }) {
  const limit = Math.min(Math.max(Number(q.limit) || 25, 1), 100);
  const before = q.before ? new Date(q.before) : null;
  if (before && Number.isNaN(before.getTime())) throw new Error("BAD_CURSOR");
  const where = { userId, ...(q.filter === "unread" ? { readAt: null } : {}), ...(before ? { createdAt: { lt: before } } : {}) };
  const [rows, unread, total] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, select: SELECT }),
    prisma.notification.count({ where: { userId, readAt: null } }),
    prisma.notification.count({ where: { userId } }),
  ]);
  const items = rows.slice(0, limit);
  return { unread, total, items, hasMore: rows.length > limit, next: rows.length > limit ? items[items.length - 1]!.createdAt : null };
}

export async function markRead(userId: string, id: string) {
  // userId is part of the filter: another person's id changes nothing.
  const res = await prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
  return { updated: res.count };
}

export async function markAllRead(userId: string) {
  const res = await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  return { updated: res.count };
}
