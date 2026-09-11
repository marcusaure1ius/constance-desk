import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/google/auth", () => ({ getGoogleAccess: vi.fn() }));

import { getGoogleAccess } from "@/lib/google/auth";
import { GOOGLE_MESSAGES } from "@/lib/google/errors";
import { batchUpdate, getPresentation, SLIDES_API } from "@/lib/google/slides";

const EMAIL = "constance@project.iam.gserviceaccount.com";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.mocked(getGoogleAccess).mockResolvedValue({ accessToken: "token-1", clientEmail: EMAIL });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getPresentation", () => {
  it("читает только нужные поля с токеном сервисного аккаунта", async () => {
    const page = { pageSize: { width: { magnitude: 9144000, unit: "EMU" }, height: { magnitude: 5143500, unit: "EMU" } }, slides: [] };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(page));

    const presentation = await getPresentation("pres-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      `${SLIDES_API}/pres-1?fields=${encodeURIComponent("pageSize,slides(objectId,pageElements(objectId))")}`
    );
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token-1");
    expect(presentation).toEqual(page);
  });
});

describe("batchUpdate", () => {
  it("отправляет все запросы одним POST", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ replies: [] }));

    await batchUpdate("pres-1", [{ deleteObject: { objectId: "x" } }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${SLIDES_API}/pres-1:batchUpdate`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ requests: [{ deleteObject: { objectId: "x" } }] });
  });
});

describe("ошибки Slides API", () => {
  it.each([
    [401, "{}", GOOGLE_MESSAGES.badKey],
    [403, "{}", GOOGLE_MESSAGES.forbidden(EMAIL)],
    [
      403,
      JSON.stringify({
        error: {
          code: 403,
          message: "Google Slides API has not been used in project 123456789 before or it is disabled.",
          status: "PERMISSION_DENIED",
          details: [{ reason: "SERVICE_DISABLED" }],
        },
      }),
      GOOGLE_MESSAGES.apiDisabled,
    ],
    [404, "{}", GOOGLE_MESSAGES.notFound],
    [429, "{}", GOOGLE_MESSAGES.unavailable],
    [503, "{}", GOOGLE_MESSAGES.unavailable],
    [
      400,
      JSON.stringify({ error: { message: "Invalid requests[3].createTable" } }),
      GOOGLE_MESSAGES.rejected("Invalid requests[3].createTable"),
    ],
    [400, "not json", GOOGLE_MESSAGES.rejected("HTTP 400")],
  ])("%i → понятное сообщение", async (status, body, message) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status }));
    await expect(batchUpdate("pres-1", [])).rejects.toThrow(message);
  });

  it("сеть недоступна — Google временно недоступен", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await expect(getPresentation("pres-1")).rejects.toThrow(GOOGLE_MESSAGES.unavailable);
  });
});
