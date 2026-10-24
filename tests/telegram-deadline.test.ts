import { describe, it, expect, vi } from "vitest";
import type { RunAgentOptions } from "@/lib/agent/loop";

// Настоящий цикл ушёл бы в сеть: подменяем его и смотрим, с какими опциями
// его зовут зависимости бота по умолчанию.
const seen: RunAgentOptions[] = [];
vi.mock("@/lib/agent/loop", () => ({
  runAgent: async function* (options: RunAgentOptions) {
    seen.push(options);
    yield { type: "text", text: "ок" };
  },
}));

import { defaultDeps } from "@/lib/telegram/handle-update";

describe("дедлайн функции доходит до агентов бота", () => {
  it("захват и вопрос к доске заканчивают раньше смерти функции, с запасом на ответ", async () => {
    seen.length = 0;
    const deadlineAt = Date.now() + 300_000;
    const deps = defaultDeps({ deadlineAt });

    await deps.buildDraft({
      inbound: { text: "a", links: [], hasUnreadableMedia: false },
      environmentId: "env-1",
      today: "2026-10-24",
    });
    await deps.answerBoardQuestion("что на сегодня", { environmentId: "env-1", today: "2026-10-24" });

    expect(seen).toHaveLength(2);
    for (const options of seen) {
      expect(options.deadlineAt).toBeDefined();
      expect(options.deadlineAt!).toBeLessThan(deadlineAt);
      expect(options.deadlineAt!).toBeGreaterThanOrEqual(deadlineAt - 30_000);
    }
  });
});
