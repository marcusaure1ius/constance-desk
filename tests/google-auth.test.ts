import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { decodeJwt, decodeProtectedHeader, exportPKCS8, generateKeyPair } from "jose";
import {
  getGoogleAccess,
  parseServiceAccountKey,
  resetGoogleTokenCache,
  SLIDES_SCOPE,
  TOKEN_URL,
} from "@/lib/google/auth";
import { GOOGLE_MESSAGES } from "@/lib/google/errors";

const EMAIL = "constance@project.iam.gserviceaccount.com";
let pem = "";

beforeAll(async () => {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  pem = await exportPKCS8(privateKey);
});

function keyJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "service_account",
    client_email: EMAIL,
    private_key: pem,
    private_key_id: "kid-1",
    ...overrides,
  });
}

function tokenResponse(token = "token-1", expiresIn = 3600): Response {
  return new Response(JSON.stringify({ access_token: token, expires_in: expiresIn, token_type: "Bearer" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  resetGoogleTokenCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("parseServiceAccountKey", () => {
  it("принимает сырой JSON", () => {
    expect(parseServiceAccountKey(keyJson()).client_email).toBe(EMAIL);
  });

  it("принимает base64 от JSON", () => {
    const encoded = Buffer.from(keyJson()).toString("base64");
    expect(parseServiceAccountKey(encoded).private_key).toBe(pem);
  });

  it("возвращает переводы строк, превращённые в буквальные \\n", () => {
    const mangled = keyJson({ private_key: "-----BEGIN PRIVATE KEY-----\\nAAA\\n-----END PRIVATE KEY-----\\n" });
    expect(parseServiceAccountKey(mangled).private_key).toBe(
      "-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----\n"
    );
  });

  it.each([
    ["не JSON и не base64 от JSON", "не ключ"],
    ["нет client_email", JSON.stringify({ private_key: "x" })],
    ["нет private_key", JSON.stringify({ client_email: EMAIL })],
  ])("отклоняет: %s", (_, raw) => {
    expect(() => parseServiceAccountKey(raw)).toThrow(GOOGLE_MESSAGES.badKey);
  });
});

describe("getGoogleAccess", () => {
  it("без ключа в env — ошибка настройки", async () => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", "");
    await expect(getGoogleAccess()).rejects.toThrow(GOOGLE_MESSAGES.config);
  });

  it("меняет подписанный JWT на токен", async () => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", keyJson());
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(tokenResponse());

    const access = await getGoogleAccess();

    expect(access).toEqual({ accessToken: "token-1", clientEmail: EMAIL });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(TOKEN_URL);
    expect(init?.method).toBe("POST");
    const body = new URLSearchParams(init?.body as URLSearchParams);
    expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const assertion = body.get("assertion")!;
    expect(decodeProtectedHeader(assertion)).toMatchObject({ alg: "RS256", kid: "kid-1" });
    const claims = decodeJwt(assertion);
    expect(claims).toMatchObject({ iss: EMAIL, aud: TOKEN_URL, scope: SLIDES_SCOPE });
    expect(claims.exp! - claims.iat!).toBe(3600);
  });

  it("держит токен в памяти, пока он не истёк", async () => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", keyJson());
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => tokenResponse());
    await getGoogleAccess();
    await getGoogleAccess();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("обновляет токен за минуту до истечения", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-11T10:00:00Z"));
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", keyJson());
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tokenResponse("token-1"))
      .mockResolvedValueOnce(tokenResponse("token-2"));

    await getGoogleAccess();
    vi.setSystemTime(new Date("2026-09-11T10:59:01Z"));
    const access = await getGoogleAccess();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(access.accessToken).toBe("token-2");
  });

  it.each([
    [400, GOOGLE_MESSAGES.badKey],
    [401, GOOGLE_MESSAGES.badKey],
    [429, GOOGLE_MESSAGES.unavailable],
    [503, GOOGLE_MESSAGES.unavailable],
  ])("ответ токен-эндпоинта %i → понятная ошибка", async (status, message) => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", keyJson());
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"error":"invalid_grant"}', { status }));
    await expect(getGoogleAccess()).rejects.toThrow(message);
  });

  it("сеть недоступна — Google временно недоступен", async () => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", keyJson());
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await expect(getGoogleAccess()).rejects.toThrow(GOOGLE_MESSAGES.unavailable);
  });

  it("ключ, который не читается как PKCS8, — ключ не принят", async () => {
    vi.stubEnv(
      "GOOGLE_SERVICE_ACCOUNT_KEY",
      keyJson({ private_key: "-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----" })
    );
    await expect(getGoogleAccess()).rejects.toThrow(GOOGLE_MESSAGES.badKey);
  });
});
