"use server";

import { revalidatePath } from "next/cache";
import {
  createColumn,
  updateColumn,
  deleteColumn,
  reorderColumns,
} from "@/lib/services/columns";

export async function createColumnAction(title: string, environmentId: string) {
  const col = await createColumn(title, environmentId);
  revalidatePath("/");
  revalidatePath("/settings");
  return col;
}

export async function updateColumnAction(id: string, title: string) {
  const col = await updateColumn(id, title);
  revalidatePath("/");
  revalidatePath("/settings");
  return col;
}

export async function deleteColumnAction(id: string) {
  const result = await deleteColumn(id);
  if (result.error) return result;
  revalidatePath("/");
  revalidatePath("/settings");
  return {};
}

export async function reorderColumnsAction(orderedIds: string[]) {
  await reorderColumns(orderedIds);
  revalidatePath("/");
  revalidatePath("/settings");
}
