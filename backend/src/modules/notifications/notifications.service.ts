import { prisma } from "../../lib/prisma.js";

// A person only ever sees and changes their OWN notifications.

export async function listMine(userId: string) {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true },
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { unread, items };
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
