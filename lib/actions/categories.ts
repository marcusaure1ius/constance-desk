"use server";

import { revalidatePath } from "next/cache";
import {
  createCategory,
  updateCategory,
  deleteCategory,
} from "@/lib/services/categories";

export async function createCategoryAction(name: string, color: string | undefined, environmentId: string) {
  const cat = await createCategory(name, color, environmentId);
  revalidatePath("/");
  revalidatePath("/settings");
  return cat;
}

export async function updateCategoryAction(
  id: string,
  data: { name?: string; color?: string }
) {
  const cat = await updateCategory(id, data);
  revalidatePath("/");
  revalidatePath("/settings");
  return cat;
}

export async function deleteCategoryAction(id: string) {
  await deleteCategory(id);
  revalidatePath("/");
  revalidatePath("/settings");
}
