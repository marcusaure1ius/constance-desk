import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetEnvironmentById,
  mockGetColumns,
  mockGetCategories,
  mockGetTasks,
} = vi.hoisted(() => ({
  mockGetEnvironmentById: vi.fn(),
  mockGetColumns: vi.fn(),
  mockGetCategories: vi.fn(),
  mockGetTasks: vi.fn(),
}));

vi.mock("@/lib/services/environments", () => ({ getEnvironmentById: mockGetEnvironmentById }));
vi.mock("@/lib/services/columns", () => ({ getColumns: mockGetColumns }));
vi.mock("@/lib/services/categories", () => ({ getCategories: mockGetCategories }));
vi.mock("@/lib/services/tasks", () => ({ getTasks: mockGetTasks }));

import { getBoardSnapshot } from "@/lib/agent/board";

describe("getBoardSnapshot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("возвращает null, если среда не найдена", async () => {
    mockGetEnvironmentById.mockResolvedValue(null);
    const res = await getBoardSnapshot("missing");
    expect(res).toBeNull();
  });

  it("собирает снимок доски", async () => {
    const env = { id: "env-1", name: "Work" };
    const columns = [{ id: "c1", title: "Бэклог" }];
    const categories = [{ id: "cat-1", name: "Запуск MVP" }];
    const tasks = [{ id: "t1", title: "Задача" }];
    mockGetEnvironmentById.mockResolvedValue(env);
    mockGetColumns.mockResolvedValue(columns);
    mockGetCategories.mockResolvedValue(categories);
    mockGetTasks.mockResolvedValue(tasks);

    const res = await getBoardSnapshot("env-1");
    expect(res).toEqual({ environment: env, columns, categories, tasks });
  });
});
