import { describe, it, expect } from "vitest";
import {
  createCategorySchema,
  createTaskSchema,
  epicTaskSchema,
} from "@/lib/agent/schemas";

describe("createCategorySchema", () => {
  it("принимает валидный вход", () => {
    const r = createCategorySchema.safeParse({ name: "Запуск MVP", environmentId: "env-1" });
    expect(r.success).toBe(true);
  });
  it("отклоняет пустое name", () => {
    const r = createCategorySchema.safeParse({ name: "", environmentId: "env-1" });
    expect(r.success).toBe(false);
  });
  it("отклоняет отсутствие environmentId", () => {
    const r = createCategorySchema.safeParse({ name: "Эпик" });
    expect(r.success).toBe(false);
  });
});

describe("createTaskSchema", () => {
  it("отклоняет неверный priority", () => {
    const r = createTaskSchema.safeParse({ title: "T", columnId: "c1", priority: "low" });
    expect(r.success).toBe(false);
  });
  it("отклоняет дату в неверном формате", () => {
    const r = createTaskSchema.safeParse({ title: "T", columnId: "c1", plannedDate: "28.06.2026" });
    expect(r.success).toBe(false);
  });
  it("принимает корректную дату YYYY-MM-DD", () => {
    const r = createTaskSchema.safeParse({ title: "T", columnId: "c1", plannedDate: "2026-06-28" });
    expect(r.success).toBe(true);
  });
});

describe("epicTaskSchema", () => {
  it("принимает валидный вход", () => {
    const r = epicTaskSchema.safeParse({
      environmentId: "env-1",
      epicName: "Запуск MVP",
      columnName: "Бэклог",
      title: "Подготовить список задач",
    });
    expect(r.success).toBe(true);
  });
  it("отклоняет пустой title", () => {
    const r = epicTaskSchema.safeParse({
      environmentId: "env-1",
      epicName: "Запуск MVP",
      columnName: "Бэклог",
      title: "",
    });
    expect(r.success).toBe(false);
  });
});
