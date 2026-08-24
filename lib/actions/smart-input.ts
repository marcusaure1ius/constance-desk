"use server";

import { parseTasks, type ParsedTask } from "@/lib/llm/parse-tasks";
import { transcribeAudio } from "@/lib/llm/transcribe";

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
