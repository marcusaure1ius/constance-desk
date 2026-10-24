import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// Сервисы мокаются только чтобы не тянуть БД: утверждения ниже — о самом реестре.
const mocks = vi.hoisted(() => ({
  getEnvironments: vi.fn(),
  getBoardSnapshot: vi.fn(),
  withSubtasks: vi.fn(async (tasks: { id: string }[]) => tasks.map((t) => ({ ...t, subtasks: [] }))),
  createSubtask: vi.fn(),
  updateSubtask: vi.fn(),
  deleteSubtask: vi.fn(),
  getTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  moveTask: vi.fn(),
  deleteTask: vi.fn(),
  createCategory: vi.fn(),
  createEpicTask: vi.fn(),
  listFoldersWithPaths: vi.fn(),
  listNotesWithPaths: vi.fn(),
  requireNoteByPath: vi.fn(),
  createNoteByPath: vi.fn(),
  appendToNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
  searchNotes: vi.fn(),
}));

vi.mock("@/lib/services/environments", () => ({ getEnvironments: mocks.getEnvironments }));
vi.mock("@/lib/agent/board", () => ({
  getBoardSnapshot: mocks.getBoardSnapshot,
  withSubtasks: mocks.withSubtasks,
}));
vi.mock("@/lib/services/subtasks", () => ({
  createSubtask: mocks.createSubtask,
  updateSubtask: mocks.updateSubtask,
  deleteSubtask: mocks.deleteSubtask,
}));
vi.mock("@/lib/agent/epic-task", () => ({ createEpicTask: mocks.createEpicTask }));
vi.mock("@/lib/services/categories", () => ({ createCategory: mocks.createCategory }));
vi.mock("@/lib/services/tasks", () => ({
  getTasks: mocks.getTasks,
  createTask: mocks.createTask,
  updateTask: mocks.updateTask,
  moveTask: mocks.moveTask,
  deleteTask: mocks.deleteTask,
}));
vi.mock("@/lib/services/notes", () => ({
  listFoldersWithPaths: mocks.listFoldersWithPaths,
  listNotesWithPaths: mocks.listNotesWithPaths,
  requireNoteByPath: mocks.requireNoteByPath,
  createNoteByPath: mocks.createNoteByPath,
  appendToNote: mocks.appendToNote,
  updateNote: mocks.updateNote,
  deleteNote: mocks.deleteNote,
}));
vi.mock("@/lib/services/search", () => ({ searchNotes: mocks.searchNotes }));

import { boardTools, findTool, toolsFor } from "@/lib/agent/tools";
import { isDeferred, runTool, toFunctionSpec, toJsonSchema } from "@/lib/agent/tool-registry";

const READ_TOOLS = [
  "get_board",
  "list_environments",
  "list_tasks",
  "list_note_folders",
  "list_notes",
  "read_note",
  "search_notes",
];
const MUTATION_TOOLS = [
  "create_epic",
  "create_epic_task",
  "create_task",
  "delete_task",
  "move_task",
  "update_task",
  "create_subtask",
  "complete_subtask",
  "update_subtask",
  "delete_subtask",
  "append_note",
  "create_note",
  "delete_note",
  "update_note",
];

const names = (tools: readonly { name: string }[]) => tools.map((t) => t.name).sort();

describe("реестр инструментов", () => {
  beforeEach(() => vi.clearAllMocks());

  it("имена уникальны", () => {
    const all = boardTools.map((t) => t.name);
    expect(new Set(all).size).toBe(all.length);
  });

  it("содержит ровно инструменты доски", () => {
    expect(names(boardTools)).toEqual([...READ_TOOLS, ...MUTATION_TOOLS].sort());
  });

  it("у каждого инструмента заполнены название, описание и поверхности", () => {
    for (const tool of boardTools) {
      expect(tool.title.length, tool.name).toBeGreaterThan(0);
      expect(tool.description.length, tool.name).toBeGreaterThan(0);
      expect(tool.surfaces.length, tool.name).toBeGreaterThan(0);
      expect(tool.surfaces.every((s) => s === "mcp" || s === "chat"), tool.name).toBe(true);
      expect(typeof tool.mutation, tool.name).toBe("boolean");
    }
  });

  it("мутирующие инструменты помечены mutation: true", () => {
    expect(names(boardTools.filter((t) => t.mutation))).toEqual([...MUTATION_TOOLS].sort());
  });

  it("читающие инструменты помечены mutation: false", () => {
    expect(names(boardTools.filter((t) => !t.mutation))).toEqual([...READ_TOOLS].sort());
  });
});

describe("подзадачи при создании задачи", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create_task создаёт подзадачи по порядку", async () => {
    mocks.createTask.mockResolvedValue({ id: "t1", title: "Задача" });
    mocks.createSubtask.mockImplementation(async (input: { title: string }) => ({
      id: `s_${input.title}`,
      ...input,
    }));

    const tool = findTool("create_task", { surface: "chat" })!;
    const outcome = await runTool(tool, {
      title: "Задача",
      columnId: "c",
      subtasks: [{ title: "a" }, { title: "b", dueDate: "2026-10-31" }],
    });

    expect(outcome.ok).toBe(true);
    expect(mocks.createTask).toHaveBeenCalledWith({ title: "Задача", columnId: "c" });
    expect(mocks.createSubtask).toHaveBeenCalledTimes(2);
    expect(mocks.createSubtask).toHaveBeenNthCalledWith(1, { taskId: "t1", title: "a", dueDate: undefined });
    expect(mocks.createSubtask).toHaveBeenNthCalledWith(2, { taskId: "t1", title: "b", dueDate: "2026-10-31" });
    expect(outcome.ok && (outcome.data as { subtasks: unknown[] }).subtasks).toHaveLength(2);
  });
});

describe("JSON Schema всего реестра", () => {
  it("строится для каждого инструмента без исключений", () => {
    for (const tool of boardTools) {
      expect(() => toJsonSchema(tool), tool.name).not.toThrow();
      expect(toJsonSchema(tool).type, tool.name).toBe("object");
    }
  });

  it("отражает обязательные поля схемы", () => {
    const schema = toJsonSchema(findTool("create_task", { surface: "chat" })!);
    expect(schema).toMatchObject({
      properties: { title: { type: "string" }, columnId: { type: "string" } },
      required: ["title", "columnId"],
    });
  });

  it("описания для function calling собираются по всему реестру", () => {
    const specs = boardTools.map(toFunctionSpec);
    expect(specs.map((s) => s.function.name).sort()).toEqual(names(boardTools));
    expect(specs.every((s) => s.type === "function")).toBe(true);
    expect(specs.every((s) => s.function.parameters.type === "object")).toBe(true);
  });

  it("схемы инструментов не содержат непредставимых типов вроде z.date", () => {
    for (const tool of boardTools) {
      for (const [field, schema] of Object.entries(tool.inputSchema)) {
        expect(() => z.toJSONSchema(z.object({ [field]: schema }), { io: "input" }),
          `${tool.name}.${field}`).not.toThrow();
      }
    }
  });
});

describe("поверхности", () => {
  beforeEach(() => vi.clearAllMocks());

  it("MCP видит все инструменты доски", () => {
    expect(names(toolsFor({ surface: "mcp" }))).toEqual(names(boardTools));
  });

  it("чат видит те же инструменты", () => {
    expect(names(toolsFor({ surface: "chat" }))).toEqual(names(boardTools));
  });

  it("фаза анализа получает только читающие инструменты", () => {
    expect(names(toolsFor({ surface: "chat", includeMutations: false }))).toEqual(
      [...READ_TOOLS].sort()
    );
  });

  it("findTool не отдаёт мутирующий инструмент, когда мутации выключены", () => {
    expect(findTool("delete_task", { surface: "chat" })).toBeDefined();
    expect(findTool("delete_task", { surface: "chat", includeMutations: false })).toBeUndefined();
    expect(mocks.deleteTask).not.toHaveBeenCalled();
  });

  it("findTool не находит несуществующий инструмент", () => {
    expect(findTool("send_telegram", { surface: "chat" })).toBeUndefined();
  });
});

describe("вызов инструментов реестра", () => {
  beforeEach(() => vi.clearAllMocks());

  it("list_tasks доходит до сервиса с аргументами из схемы", async () => {
    mocks.getTasks.mockResolvedValue([{ id: "t-1" }]);
    const outcome = await runTool(findTool("list_tasks", { surface: "chat" })!, {
      environmentId: "env-1",
      includeArchived: true,
    });

    expect(outcome).toEqual({ ok: true, data: [{ id: "t-1", subtasks: [] }] });
    expect(mocks.getTasks).toHaveBeenCalledWith("env-1", { includeArchived: true });
  });

  it("get_board отвечает провалом, если среда не найдена", async () => {
    mocks.getBoardSnapshot.mockResolvedValue(null);
    const outcome = await runTool(findTool("get_board", { surface: "chat" })!, {
      environmentId: "missing",
    });

    expect(outcome).toEqual({ ok: false, error: "Среда не найдена" });
  });

  it("update_task отделяет id от изменяемых полей", async () => {
    mocks.updateTask.mockResolvedValue({ id: "t-1" });
    await runTool(findTool("update_task", { surface: "chat" })!, {
      id: "t-1",
      title: "Новое",
      priority: "high",
    });

    expect(mocks.updateTask).toHaveBeenCalledWith("t-1", { title: "Новое", priority: "high" });
  });

  it("невалидный аргумент не доходит до сервиса", async () => {
    const outcome = await runTool(findTool("update_task", { surface: "chat" })!, {
      id: "t-1",
      plannedDate: "30-06-2026",
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error).toContain("plannedDate");
    expect(mocks.updateTask).not.toHaveBeenCalled();
  });
});

describe("impact инструментов доски", () => {
  it("перехватываются ровно те инструменты, которые нельзя откатить глазами", () => {
    const deferred = boardTools.filter(isDeferred).map((t) => t.name).sort();

    expect(deferred).toEqual([
      "create_epic",
      "create_epic_task",
      "create_note",
      "create_subtask",
      "create_task",
      "delete_note",
      "delete_subtask",
      "delete_task",
      "update_note",
      "update_subtask",
      "update_task",
    ]);
  });

  it("перенос задачи исполняется без подтверждения", () => {
    const move = boardTools.find((t) => t.name === "move_task");
    expect(move?.impact).toBe("reversible");
  });

  // Дописанное в заметку видно и снимается руками — в отличие от текста,
  // затёртого перезаписью.
  it("дописывание в заметку исполняется без подтверждения", () => {
    const append = boardTools.find((t) => t.name === "append_note");
    expect(append?.impact).toBe("reversible");
  });

  it("у каждого инструмента задан impact", () => {
    expect(boardTools.every((t) => t.impact)).toBe(true);
  });
});

describe("инструменты подзадач", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create_subtask передаёт задачу, название и срок в сервис", async () => {
    mocks.createSubtask.mockResolvedValue({ id: "s-1" });
    const outcome = await runTool(findTool("create_subtask", { surface: "chat" })!, {
      taskId: "t-1",
      title: "Позвонить",
      dueDate: "2026-10-30",
    });

    expect(outcome.ok).toBe(true);
    expect(mocks.createSubtask).toHaveBeenCalledWith({
      taskId: "t-1",
      title: "Позвонить",
      dueDate: "2026-10-30",
    });
  });

  it("complete_subtask исполняется сразу и ставит отметку", async () => {
    const tool = findTool("complete_subtask", { surface: "chat" })!;
    expect(isDeferred(tool)).toBe(false);

    mocks.updateSubtask.mockResolvedValue({ id: "s-1", title: "Слайды" });
    const outcome = await runTool(tool, { id: "s-1", done: true });
    expect(mocks.updateSubtask).toHaveBeenCalledWith("s-1", { done: true });
    expect(outcome).toEqual({ ok: true, data: { success: true, title: "Слайды", done: true } });
  });

  it("complete_subtask по несуществующему id — провал, а не пустой успех", async () => {
    mocks.updateSubtask.mockResolvedValue(undefined);
    const outcome = await runTool(findTool("complete_subtask", { surface: "chat" })!, {
      id: "missing",
      done: true,
    });
    expect(outcome).toEqual({ ok: false, error: "Подзадача не найдена" });
  });

  it("update_subtask снимает срок через null и не пропускает кривую дату", async () => {
    const tool = findTool("update_subtask", { surface: "chat" })!;
    mocks.updateSubtask.mockResolvedValue({ id: "s-1" });

    await runTool(tool, { id: "s-1", dueDate: null });
    expect(mocks.updateSubtask).toHaveBeenCalledWith("s-1", { dueDate: null });

    const bad = await runTool(tool, { id: "s-1", dueDate: "30.10.2026" });
    expect(bad.ok).toBe(false);
    expect(mocks.updateSubtask).toHaveBeenCalledTimes(1);
  });

  it("delete_subtask удаляет по id", async () => {
    const outcome = await runTool(findTool("delete_subtask", { surface: "chat" })!, { id: "s-1" });
    expect(outcome).toEqual({ ok: true, data: { success: true } });
    expect(mocks.deleteSubtask).toHaveBeenCalledWith("s-1");
  });
});
