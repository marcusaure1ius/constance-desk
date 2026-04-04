"use server";

import { parseTasks, transcribeAudio } from "@/lib/services/groq";
import type { ParsedTask } from "@/lib/services/groq";

export async function parseTasksAction(text: string): Promise<ParsedTask[]> {
  if (!text.trim()) return [];
  return parseTasks(text.trim());
}

export async function transcribeAction(formData: FormData): Promise<string> {
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    throw new Error("Файл не найден");
  }
  return transcribeAudio(file);
}
