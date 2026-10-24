"use server";

import { revalidatePath } from "next/cache";
import {
  createSubtask as createSubtaskService,
  updateSubtask as updateSubtaskService,
  deleteSubtask as deleteSubtaskService,
  type CreateSubtaskInput,
} from "@/lib/services/subtasks";

export async function createSubtaskAction(input: CreateSubtaskInput) {
  const subtask = await createSubtaskService(input);
  revalidatePath("/");
  return subtask;
}

export async function updateSubtaskAction(
  id: string,
  data: Partial<{ title: string; dueDate: string | null; done: boolean }>
) {
  const subtask = await updateSubtaskService(id, data);
  revalidatePath("/");
  return subtask;
}

export async function deleteSubtaskAction(id: string) {
  await deleteSubtaskService(id);
  revalidatePath("/");
}
