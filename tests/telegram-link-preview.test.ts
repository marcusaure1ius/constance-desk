import { describe, it, expect, vi } from "vitest";
import { fetchLinkPreview } from "@/lib/telegram/link-preview";

const html = (body: string, type = "text/html; charset=utf-8") =>
  new Response(body, { headers: { "content-type": type } });

describe("fetchLinkPreview", () => {
  it("og:title предпочтительнее <title>, og:description — meta description", async () => {
    const fetchFn = vi.fn(async () =>
      html(
        `<html><head><title>Обычный</title>
        <meta name="description" content="Обычное описание">
        <meta property="og:title" content="Заголовок &amp; &quot;кавычки&quot;">
        <meta property="og:description" content="Описание"></head></html>`
      )
    ) as unknown as typeof fetch;
    const preview = await fetchLinkPreview("https://example.com", { fetchFn });
    expect(preview).toEqual({ title: 'Заголовок & "кавычки"', description: "Описание" });
  });

  it("без og берёт <title> и meta description", async () => {
    const fetchFn = (async () =>
      html(`<title> Страница </title><meta content="Про это" name="description">`)) as unknown as typeof fetch;
    expect(await fetchLinkPreview("https://example.com", { fetchFn })).toEqual({
      title: "Страница",
      description: "Про это",
    });
  });

  it("не HTML — пустой результат", async () => {
    const fetchFn = (async () => html("{}", "application/json")) as unknown as typeof fetch;
    expect(await fetchLinkPreview("https://example.com/a.json", { fetchFn })).toEqual({});
  });

  it("ошибка сети — пустой результат", async () => {
    const fetchFn = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    expect(await fetchLinkPreview("https://example.com", { fetchFn })).toEqual({});
  });

  it("висящий fetch обрывается по таймауту", async () => {
    const fetchFn = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    const started = Date.now();
    const preview = await fetchLinkPreview("https://example.com", { fetchFn, timeoutMs: 50 });
    expect(preview).toEqual({});
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("читает не больше 256 КБ", async () => {
    const big = `<title>Начало</title>${"a".repeat(600 * 1024)}<meta property="og:title" content="Поздно">`;
    const fetchFn = (async () => html(big)) as unknown as typeof fetch;
    expect(await fetchLinkPreview("https://example.com", { fetchFn })).toEqual({ title: "Начало" });
  });

  it("голый домен из entity url — запрос по https://", async () => {
    const fetchFn = vi.fn(async () => html("<title>Дека</title>"));
    const preview = await fetchLinkPreview("example.com/deck", {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(preview).toEqual({ title: "Дека" });
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe("https://example.com/deck");
  });

  it("схема с портом и http оставляются как есть", async () => {
    const fetchFn = vi.fn(async () => html("<title>x</title>"));
    await fetchLinkPreview("http://example.com:8080/a", { fetchFn: fetchFn as unknown as typeof fetch });
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe("http://example.com:8080/a");
  });

  it.each(["ftp://example.com/file", "file:///etc/passwd", "mailto:a@b.ru", "javascript:alert(1)"])(
    "не http(s) — без запроса: %s",
    async (url) => {
      const fetchFn = vi.fn();
      expect(await fetchLinkPreview(url, { fetchFn: fetchFn as unknown as typeof fetch })).toEqual({});
      expect(fetchFn).not.toHaveBeenCalled();
    }
  );
});
