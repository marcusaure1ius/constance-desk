"use server";

import { revalidatePath } from "next/cache";
import {
  createTask as createTaskService,
  updateTask as updateTaskService,
  deleteTask as deleteTaskService,
  moveTask as moveTaskService,
  type CreateTaskInput,
} from "@/lib/services/tasks";

export async function createTaskAction(input: CreateTaskInput) {
  const task = await createTaskService(input);
  revalidatePath("/");
  return task;
}

export async function updateTaskAction(
  id: string,
  data: Partial<{
    title: string;
    description: string | null;
    categoryId: string | null;
    priority: "urgent" | "high" | "normal";
    plannedDate: string | null;
  }>
) {
  const task = await updateTaskService(id, data);
  revalidatePath("/");
  return task;
}

export async function deleteTaskAction(id: string) {
  await deleteTaskService(id);
  revalidatePath("/");
}

export async function moveTaskAction(
  taskId: string,
  targetColumnId: string,
  targetPosition: number
) {
  await moveTaskService(taskId, targetColumnId, targetPosition);
  revalidatePath("/");
}

import { getWeeklyReport, formatReportAsText } from "@/lib/services/reports";

export async function getReportAction(dateStr: string) {
  const date = new Date(dateStr);
  return getWeeklyReport(date);
}

export async function getReportTextAction(dateStr: string) {
  const date = new Date(dateStr);
  const report = await getWeeklyReport(date);
  return formatReportAsText(report);
}
