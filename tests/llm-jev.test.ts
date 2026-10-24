import { describe, it, expect, vi } from "vitest";
import { askJev, JEV_MODEL, type JevQuestion } from "@/lib/llm/jev";
import { LlmError } from "@/lib/llm/client";

const QUESTIONS: Record<string, JevQuestion> = {
  route: {
    type: "choice",
    instructions: "Что хочет автор?",
    criteria: { capture: "записать", smalltalk: "поздороваться" },
  },
  correction: { type: "noul", instructions: "Это поправка?" },
};

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const OK_BODY = {
  answers: {
    route: {
      choice: "capture",
      confidence: 0.91,
      probabilities: { capture: 0.91, smalltalk: 0.09 },
    },
    correction: { noul: 0.2 },
  },
  usage: { cost: 0.00003 },
};

describe("askJev", () => {
  it("шлёт модель, вопросы и состояние на decisions с Bearer-ключом", async () => {
    const fetchFn = vi.fn().mockResolvedValue(reply(OK_BODY));
    await askJev({ questions: QUESTIONS, state: { message: "привет" }, apiKey: "k", fetchFn });

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(JSON.parse(init.body as string)).toEqual({
      model: JEV_MODEL,
      questions: QUESTIONS,
      state: { message: "привет" },
    });
    expect(JEV_MODEL).toBe("typesafe/jev-1.14");
  });

  it("разбирает choice и noul, отдаёт цену и задержку", async () => {
    const fetchFn = vi.fn().mockResolvedValue(reply(OK_BODY));
    const result = await askJev({ questions: QUESTIONS, state: {}, apiKey: "k", fetchFn });

    expect(result.answers.route).toEqual({
      type: "choice",
      choice: "capture",
      confidence: 0.91,
      probabilities: { capture: 0.91, smalltalk: 0.09 },
    });
    expect(result.answers.correction).toEqual({ type: "noul", noul: 0.2 });
    expect(result.cost).toBe(0.00003);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("не-2xx превращает в LlmError со статусом", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("slow down", { status: 429 }));
    const error = await askJev({ questions: QUESTIONS, state: {}, apiKey: "k", fetchFn }).catch(
      (e) => e
    );
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).status).toBe(429);
  });

  it("ответ без нужных answers — ошибка", async () => {
    const fetchFn = vi.fn().mockResolvedValue(reply({ answers: {} }));
    await expect(
      askJev({ questions: QUESTIONS, state: {}, apiKey: "k", fetchFn })
    ).rejects.toThrow(/answers/);
  });

  it("таймаут — ошибка с текстом timeout", async () => {
    const fetchFn = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    });
    await expect(
      askJev({
        questions: QUESTIONS,
        state: {},
        apiKey: "k",
        timeoutMs: 20,
        fetchFn: fetchFn as unknown as typeof fetch,
      })
    ).rejects.toThrow(/timeout/);
  });
});
