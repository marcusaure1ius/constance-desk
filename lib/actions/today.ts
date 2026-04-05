"use server";

import { revalidatePath } from "next/cache";
import { updateTask } from "@/lib/services/tasks";

export async function addToPlanAction(taskId: string) {
  const today = new Date().toISOString().split("T")[0];
  await updateTask(taskId, { plannedDate: today });
  revalidatePath("/today");
}
