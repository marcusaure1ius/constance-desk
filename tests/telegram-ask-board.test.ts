import { describe, it, expect, vi } from "vitest";
import { answerBoardQuestion } from "@/lib/telegram/ask-board";
import type { runAgent } from "@/lib/agent/loop";

function fakeAgent(events: unknown[]) {
  return vi.fn(async function* () {
    for (const e of events) yield e;
  }) as unknown as typeof runAgent & ReturnType<typeof vi.fn>;
}

const input = { environmentId: "env-1", today: "2026-10-24" };

describe("answerBoardQuestion", () => {
  it("отдаёт только немутирующие инструменты и системный промпт для Телеграма", async () => {
    const agent = fakeAgent([{ type: "text", text: "Пусто" }]);
    await answerBoardQuestion("что на сегодня?", input, { runAgent: agent });
    const opts = (agent as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(opts.tools.length).toBeGreaterThan(0);
    expect(opts.tools.every((t: { mutation?: boolean }) => !t.mutation)).toBe(true);
    expect(opts.environmentId).toBe("env-1");
    expect(opts.systemPrompt).toContain("Телеграме");
  });

  it("берёт последний text и переводит в HTML", async () => {
    const agent = fakeAgent([
      { type: "text", text: "черновик" },
      { type: "proposal", proposal: {} },
      { type: "text", text: "**Итог** <1>" },
    ]);
    const res = await answerBoardQuestion("q", input, { runAgent: agent });
    expect(res).toEqual({ ok: true, html: "<b>Итог</b> &lt;1&gt;" });
  });

  it("режет до 4096", async () => {
    const agent = fakeAgent([{ type: "text", text: "я".repeat(9000) }]);
    const res = await answerBoardQuestion("q", input, { runAgent: agent });
    expect(res.ok && res.html.length).toBeLessThanOrEqual(4096);
  });

  it("error без text — ok:false", async () => {
    const agent = fakeAgent([{ type: "error", message: "сбой" }]);
    expect(await answerBoardQuestion("q", input, { runAgent: agent })).toEqual({
      ok: false,
      error: "сбой",
    });
  });

  it("без text и без error — ok:false", async () => {
    const agent = fakeAgent([{ type: "thinking" }]);
    const res = await answerBoardQuestion("q", input, { runAgent: agent });
    expect(res.ok).toBe(false);
  });

  it("до 10 шагов и дедлайн функции", async () => {
    const agent = fakeAgent([{ type: "text", text: "Пусто" }]);
    await answerBoardQuestion("q", input, { runAgent: agent, deadlineAt: 42 });
    const opts = (agent as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(opts.maxSteps).toBe(10);
    expect(opts.deadlineAt).toBe(42);
  });
});

describe("answerBoardQuestion со снимком доски", () => {
  const board = {
    text: "# Доска сейчас\n- t1 «Отчёт» · В работе · срок 2026-10-24",
    tasks: [{ id: "t1", title: "Отчёт", description: null, subtasks: [] }],
  };

  it("снимок — в системном промпте, правило «отвечай по нему сразу», задачи — в knownTasks", async () => {
    const agent = fakeAgent([{ type: "text", text: "Отчёт" }]);
    await answerBoardQuestion("что у меня на сегодня?", { ...input, board }, { runAgent: agent });
    const opts = (agent as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(opts.systemPrompt).toContain(board.text);
    expect(opts.systemPrompt).toContain("без инструментов");
    expect(opts.systemPrompt).not.toContain("(list_environments)");
    expect(opts.knownTasks).toBe(board.tasks);
  });

  it("без снимка — прежнее правило про list_environments", async () => {
    const agent = fakeAgent([{ type: "text", text: "Пусто" }]);
    await answerBoardQuestion("q", input, { runAgent: agent });
    const opts = (agent as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(opts.systemPrompt).toContain("list_environments");
    expect(opts.knownTasks).toBeUndefined();
  });
});

describe("dropNarration", () => {
  it("срезает первую строку-пересказ действий, если за ней есть ответ", async () => {
    const { dropNarration } = await import("@/lib/telegram/ask-board");
    expect(dropNarration("Смотрю задачи с сегодняшним сроком.\n\nНа сегодня пусто.")).toBe("На сегодня пусто.");
    expect(dropNarration("Сейчас посмотрю доску:\nОтчёт")).toBe("Отчёт");
    expect(dropNarration("Смотрю задачи")).toBe("Смотрю задачи");
    expect(dropNarration("Смотрите: отчёт горит")).toBe("Смотрите: отчёт горит");
  });
});
