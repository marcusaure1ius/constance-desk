"use server";

import {
  isPinSet,
  verifyPin,
  setPin,
  setNickname,
  createSession,
  destroySession,
} from "@/lib/services/auth";
import { createEnvironment, getEnvironments } from "@/lib/services/environments";
import { db } from "@/lib/db";
import { tasks, environments, settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function loginAction(pin: string): Promise<{ error?: string }> {
  const valid = await verifyPin(pin);
  if (!valid) return { error: "Неверный PIN" };
  await createSession();
  return {};
}

export async function setupPinAction(
  pin: string,
  nickname: string
): Promise<{ error?: string }> {
  const alreadySet = await isPinSet();
  if (alreadySet) return { error: "PIN уже установлен" };
  await setPin(pin);
  await setNickname(nickname);

  // Создать дефолтную среду с колонками если нет ни одной
  const existingEnvs = await getEnvironments();
  if (existingEnvs.length === 0) {
    await createEnvironment("Основная", "#3b82f6");
  }

  await createSession();
  return {};
}

export async function changePinAction(
  currentPin: string,
  newPin: string
): Promise<{ error?: string }> {
  const valid = await verifyPin(currentPin);
  if (!valid) return { error: "Неверный текущий PIN" };
  await setPin(newPin);
  return {};
}

export async function updateNicknameAction(
  nickname: string
): Promise<{ error?: string }> {
  const trimmed = nickname.trim();
  if (!trimmed) return { error: "Ник не может быть пустым" };
  await setNickname(trimmed);
  return {};
}

export async function logoutAction(): Promise<void> {
  await destroySession();
}

export async function deleteAllDataAction(
  pin: string
): Promise<{ error?: string }> {
  const valid = await verifyPin(pin);
  if (!valid) return { error: "Неверный PIN" };

  // Удаляем всё: tasks → environments (cascade удалит columns и categories) → settings
  await db.delete(tasks);
  await db.delete(environments);
  await db
    .update(settings)
    .set({ pinHash: null, nickname: null, updatedAt: new Date() })
    .where(eq(settings.id, 1));

  await destroySession();
  return {};
}
