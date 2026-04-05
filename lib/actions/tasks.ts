"use server";

import { revalidatePath } from "next/cache";
import {
  createTask as createTaskService,
  updateTask as updateTaskService,
  deleteTask as deleteTaskService,
  moveTask as moveTaskService,
  createTasksBatch,
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

export async function createTasksBatchAction(inputs: CreateTaskInput[]) {
  const created = await createTasksBatch(inputs);
  revalidatePath("/");
  return created;
}

import { getWeeklyReport, formatReportAsText, getExtendedWeeklyReport, getWeeklyTrend } from "@/lib/services/reports";
import { generateReportPptx } from "@/lib/services/report-pptx";

export async function getReportAction(dateStr: string, environmentId: string) {
  const date = new Date(dateStr);
  return getWeeklyReport(date, environmentId);
}

export async function getReportTextAction(dateStr: string, environmentId: string) {
  const date = new Date(dateStr);
  const report = await getWeeklyReport(date, environmentId);
  return formatReportAsText(report);
}

export async function getExtendedReportAction(dateStr: string, environmentId: string) {
  const date = new Date(dateStr);
  return getExtendedWeeklyReport(date, environmentId);
}

export async function getWeeklyTrendAction(dateStr: string, environmentId: string, weeks: number = 4) {
  const date = new Date(dateStr);
  return getWeeklyTrend(date, environmentId, weeks);
}

export async function generatePptxAction(dateStr: string, environmentId: string): Promise<string> {
  const date = new Date(dateStr);
  const report = await getExtendedWeeklyReport(date, environmentId);
  const buffer = await generateReportPptx(report);
  return buffer.toString("base64");
}
