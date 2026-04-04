import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

const secret = process.env.SESSION_SECRET;
if (!secret && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET is required in production");
}
const SESSION_SECRET = new TextEncoder().encode(
  secret || "constance-default-secret-change-me"
);
const SESSION_COOKIE = "constance-session";
const SESSION_DURATION = 30 * 24 * 60 * 60; // 30 дней в секундах

export async function isPinSet(): Promise<boolean> {
  const [row] = await db
    .select({ pinHash: settings.pinHash })
    .from(settings)
    .where(eq(settings.id, 1));
  return !!row?.pinHash;
}

export async function setPin(pin: string): Promise<void> {
  const hash = await bcrypt.hash(pin, 10);
  await db
    .update(settings)
    .set({ pinHash: hash, updatedAt: new Date() })
    .where(eq(settings.id, 1));
}

export async function verifyPin(pin: string): Promise<boolean> {
  const [row] = await db
    .select({ pinHash: settings.pinHash })
    .from(settings)
    .where(eq(settings.id, 1));
  if (!row?.pinHash) return false;
  return bcrypt.compare(pin, row.pinHash);
}

export async function verifyApiKey(apiKey: string): Promise<boolean> {
  return verifyPin(apiKey);
}

export async function getNickname(): Promise<string | null> {
  const [row] = await db
    .select({ nickname: settings.nickname })
    .from(settings)
    .where(eq(settings.id, 1));
  return row?.nickname ?? null;
}

export async function setNickname(nickname: string): Promise<void> {
  await db
    .update(settings)
    .set({ nickname, updatedAt: new Date() })
    .where(eq(settings.id, 1));
}

export async function createSession(): Promise<void> {
  const token = await new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${SESSION_DURATION}s`)
    .sign(SESSION_SECRET);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_DURATION,
    path: "/",
  });
}

export async function verifySession(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, SESSION_SECRET);
    return true;
  } catch {
    return false;
  }
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
