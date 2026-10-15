import { prisma } from "../../lib/prisma.js";
import { platformToday } from "../../lib/dates.js";

// A task's weight decides how much it contributes to the day's score.
const WEIGHT_VALUES: Record<string, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 5,
};

async function context(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { platform: true },
  });
  if (!user) throw new Error("USER_NOT_FOUND");
  return { user, today: platformToday(user.platform.timezone) };
}

function score(tasks: { weight: string; status: string }[]) {
  const totalWeight = tasks.reduce(
    (n, t) => n + (WEIGHT_VALUES[t.weight] ?? 1),
    0
  );
  const doneWeight = tasks
    .filter((t) => t.status === "COMPLETED")
    .reduce((n, t) => n + (WEIGHT_VALUES[t.weight] ?? 1), 0);

  return {
    totalWeight,
    doneWeight,
    percent:
      totalWeight === 0 ? 0 : Math.round((doneWeight / totalWeight) * 100),
    total: tasks.length,
    completed: tasks.filter((t) => t.status === "COMPLETED").length,
  };
}

// CARRY-FORWARD RULE
// Today's tasks, plus anything from an earlier day still unfinished. The
// original row is never moved — its date stays, so yesterday's score is not
// rewritten. It is simply shown again today.
export async function listTasks(userId: string) {
  const { today } = await context(userId);

  const tasks = await prisma.dailyTask.findMany({
    where: {
      userId,
      OR: [
        { date: today },
        { date: { lt: today }, status: { in: ["PENDING", "IN_PROGRESS"] } },
      ],
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });

  return {
    tasks: tasks.map((t) => ({
      ...t,
      isCarriedOver: t.date.getTime() < today.getTime(),
    })),
    score: score(tasks),
  };
}

export async function createTask(
  userId: string,
  title: string,
  weight: string,
  description?: string
) {
  const { user, today } = await context(userId);

  await prisma.dailyTask.create({
    data: {
      platformId: user.platformId,
      userId,
      date: today,
      title: title.trim(),
      description: description?.trim() || null,
      weight: weight as any,
      status: "PENDING",
    },
  });

  return listTasks(userId);
}

export async function updateTask(
  userId: string,
  taskId: string,
  changes: { status?: string; title?: string; weight?: string }
) {
  const task = await prisma.dailyTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error("TASK_NOT_FOUND");
  // Ownership check — a task id in the URL is not proof it is yours.
  if (task.userId !== userId) throw new Error("NOT_YOURS");

  await prisma.dailyTask.update({
    where: { id: taskId },
    data: {
      ...(changes.status ? { status: changes.status as any } : {}),
      ...(changes.title ? { title: changes.title.trim() } : {}),
      ...(changes.weight ? { weight: changes.weight as any } : {}),
      completedAt: changes.status === "COMPLETED" ? new Date() : null,
    },
  });

  return listTasks(userId);
}

export async function deleteTask(userId: string, taskId: string) {
  const task = await prisma.dailyTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error("TASK_NOT_FOUND");
  if (task.userId !== userId) throw new Error("NOT_YOURS");

  await prisma.dailyTask.delete({ where: { id: taskId } });
  return listTasks(userId);
}