import { describe, it, expect } from "vitest";
import { formatPromptBoard } from "@/lib/telegram/board-snapshot";

function env(id: string, name: string) {
  return { id, name, position: 0, createdAt: new Date(), updatedAt: new Date() } as never;
}

function task(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Задача ${id}`,
    description: null,
    columnId: "c1",
    categoryId: null,
    plannedDate: null,
    completedAt: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    position: 0,
    subtasks: [],
    ...extra,
  };
}

const columns = [
  { id: "c1", title: "Бэклог" },
  { id: "c2", title: "Готово" },
] as never;

describe("formatPromptBoard", () => {
  it("среды, колонки с первой, эпики, задачи строкой с колонкой, эпиком, сроком и подзадачами", () => {
    const board = formatPromptBoard(
      [
        {
          environment: env("e1", "Работа"),
          columns,
          categories: [{ id: "k1", name: "Отчёты" }] as never,
          tasks: [
            task("t1", {
              title: "Отчёт",
              categoryId: "k1",
              plannedDate: "2026-10-24",
              description: "текст",
              subtasks: [{ id: "s1", title: "цифры", dueDate: null, done: true }],
            }),
          ],
        },
        { environment: env("e2", "Дом"), columns, categories: [] as never, tasks: [] },
      ],
      { activeEnvironmentId: "e1" }
    );

    expect(board.text).toContain("## Среда «Работа» id=e1 — активная");
    expect(board.text).toContain("c1 «Бэклог» (первая) | c2 «Готово»");
    expect(board.text).toContain("Эпики: k1 «Отчёты»");
    expect(board.text).toContain(
      "- t1 «Отчёт» · Бэклог · эпик «Отчёты» · срок 2026-10-24 · есть описание · подзадачи: s1 «цифры» ✓"
    );
    expect(board.text).toContain("## Среда «Дом» id=e2\n");
    expect(board.text).not.toContain("текст");
    expect(board.tasks).toEqual([
      { id: "t1", title: "Отчёт", description: "текст", subtasks: [{ id: "s1", title: "цифры" }] },
    ]);
  });

  it("сверх потолка уходят сначала выполненные, потом самые старые — и снимок говорит об этом", () => {
    const tasks = [
      task("old", { createdAt: new Date("2026-01-01T00:00:00Z") }),
      task("new", { createdAt: new Date("2026-10-20T00:00:00Z") }),
      task("done", { createdAt: new Date("2026-10-23T00:00:00Z"), completedAt: new Date(), columnId: "c2" }),
    ];
    const board = formatPromptBoard(
      [{ environment: env("e1", "Работа"), columns, categories: [] as never, tasks }],
      { activeEnvironmentId: "e1", limit: 2 }
    );
    expect(board.tasks.map((t) => t.id).sort()).toEqual(["new", "old"]);
    expect(board.text).toContain("ещё 1 не показано");

    const one = formatPromptBoard(
      [{ environment: env("e1", "Работа"), columns, categories: [] as never, tasks }],
      { activeEnvironmentId: "e1", limit: 1 }
    );
    expect(one.tasks.map((t) => t.id)).toEqual(["new"]);
  });
});
