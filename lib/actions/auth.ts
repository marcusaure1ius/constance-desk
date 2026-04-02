"use server";

import {
  isPinSet,
  verifyPin,
  setPin,
  createSession,
  destroySession,
} from "@/lib/services/auth";

export async function loginAction(pin: string): Promise<{ error?: string }> {
  const valid = await verifyPin(pin);
  if (!valid) return { error: "Неверный PIN" };
  await createSession();
  return {};
}

export async function setupPinAction(pin: string): Promise<{ error?: string }> {
  const alreadySet = await isPinSet();
  if (alreadySet) return { error: "PIN уже установлен" };
  await setPin(pin);
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

export async function logoutAction(): Promise<void> {
  await destroySession();
}
