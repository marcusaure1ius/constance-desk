import { SignJWT, importPKCS8 } from "jose";
import { z } from "zod";
import { GOOGLE_MESSAGES, GoogleSlidesError } from "./errors";

/**
 * Доступ к Google от имени сервисного аккаунта.
 *
 * Без `googleapis`: весь протокол — подписать JWT ключом аккаунта и обменять
 * его на access token одним POST. Тяжёлая зависимость ради этого не нужна, а
 * `fetch` в офлайн-тестах мокается так же, как в `lib/llm/client.ts`.
 */

export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SLIDES_SCOPE = "https://www.googleapis.com/auth/presentations";

const keySchema = z.object({
  client_email: z.string().min(1),
  private_key: z.string().min(1),
  private_key_id: z.string().optional(),
});

export type ServiceAccountKey = z.infer<typeof keySchema>;

/**
 * Ключ сервисного аккаунта: сырой JSON или base64 от него.
 *
 * base64 — ради Vercel: многострочный JSON с `\n` внутри `private_key` при
 * вставке в поле переменной легко испортить. Если JSON всё-таки вставили
 * строкой и переводы строк превратились в буквальные `\n`, они
 * восстанавливаются.
 */
export function parseServiceAccountKey(raw: string): ServiceAccountKey {
  const text = raw.trim();
  let json: unknown;
  try {
    json = JSON.parse(text.startsWith("{") ? text : Buffer.from(text, "base64").toString("utf8"));
  } catch {
    throw new GoogleSlidesError(GOOGLE_MESSAGES.badKey);
  }
  const parsed = keySchema.safeParse(json);
  if (!parsed.success) throw new GoogleSlidesError(GOOGLE_MESSAGES.badKey);
  return { ...parsed.data, private_key: parsed.data.private_key.replace(/\\n/g, "\n") };
}

export function loadServiceAccountKey(): ServiceAccountKey {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw?.trim()) throw new GoogleSlidesError(GOOGLE_MESSAGES.config);
  return parseServiceAccountKey(raw);
}

export type GoogleAccess = { accessToken: string; clientEmail: string };

let cached: { clientEmail: string; accessToken: string; expiresAt: number } | null = null;

/** Для тестов: забыть закешированный токен. */
export function resetGoogleTokenCache(): void {
  cached = null;
}

/**
 * Access token сервисного аккаунта и его email (email нужен для подсказки
 * «поделитесь презентацией с …»).
 *
 * Токен живёт час; держим его в памяти, пока до конца больше минуты, чтобы
 * не подписывать JWT на каждый запрос к Slides.
 */
export async function getGoogleAccess(): Promise<GoogleAccess> {
  const key = loadServiceAccountKey();
  if (cached && cached.clientEmail === key.client_email && cached.expiresAt > Date.now()) {
    return { accessToken: cached.accessToken, clientEmail: cached.clientEmail };
  }

  const assertion = await signAssertion(key);
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
  } catch (err) {
    console.error("[google] запрос токена не дошёл", err);
    throw new GoogleSlidesError(GOOGLE_MESSAGES.unavailable);
  }

  if (!response.ok) {
    console.error("[google] токен", response.status, await response.text());
    const temporary = response.status === 429 || response.status >= 500;
    throw new GoogleSlidesError(temporary ? GOOGLE_MESSAGES.unavailable : GOOGLE_MESSAGES.badKey);
  }

  const body = (await response.json()) as { access_token: string; expires_in: number };
  cached = {
    clientEmail: key.client_email,
    accessToken: body.access_token,
    expiresAt: Date.now() + (body.expires_in - 60) * 1000,
  };
  return { accessToken: body.access_token, clientEmail: key.client_email };
}

async function signAssertion(key: ServiceAccountKey): Promise<string> {
  let privateKey: Awaited<ReturnType<typeof importPKCS8>>;
  try {
    privateKey = await importPKCS8(key.private_key, "RS256");
  } catch {
    throw new GoogleSlidesError(GOOGLE_MESSAGES.badKey);
  }
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ scope: SLIDES_SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", ...(key.private_key_id ? { kid: key.private_key_id } : {}) })
    .setIssuer(key.client_email)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);
}
