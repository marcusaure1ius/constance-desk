"use server";

import { revalidatePath } from "next/cache";
import {
  createEnvironment,
  updateEnvironment,
  deleteEnvironment,
} from "@/lib/services/environments";
import { setActiveEnvironmentId } from "@/lib/environment";

export async function createEnvironmentAction(name: string, color: string) {
  const env = await createEnvironment(name, color);
  revalidatePath("/");
  revalidatePath("/settings");
  return env;
}

export async function updateEnvironmentAction(
  id: string,
  data: { name?: string; color?: string }
) {
  const env = await updateEnvironment(id, data);
  revalidatePath("/");
  revalidatePath("/settings");
  return env;
}

export async function deleteEnvironmentAction(id: string) {
  const result = await deleteEnvironment(id);
  if (result.error) return result;
  revalidatePath("/");
  revalidatePath("/settings");
  return {};
}

export async function switchEnvironmentAction(envId: string) {
  await setActiveEnvironmentId(envId);
  revalidatePath("/");
  revalidatePath("/settings");
}
