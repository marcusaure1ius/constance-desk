import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDb, selectChain, insertChain, updateChain, deleteChain } =
  vi.hoisted(() => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn(),
    };
    const insertChain = {
      values: vi.fn().mockReturnThis(),
      returning: vi.fn(),
    };
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn(),
    };
    const deleteChain = {
      where: vi.fn(),
    };
    const mockDb = {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => updateChain),
      delete: vi.fn(() => deleteChain),
    };
    return { mockDb, selectChain, insertChain, updateChain, deleteChain };
  });

vi.mock("@/lib/db", () => ({ db: mockDb }));

import {
  getEnvironments,
  getEnvironmentById,
  createEnvironment,
  updateEnvironment,
  deleteEnvironment,
  getActiveEnvironment,
} from "@/lib/services/environments";

describe("getEnvironments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
  });

  it("возвращает отсортированные среды", async () => {
    const envs = [
      { id: "1", name: "Работа", position: 0 },
      { id: "2", name: "Личное", position: 1 },
    ];
    selectChain.orderBy.mockResolvedValue(envs);
    const result = await getEnvironments();
    expect(result).toEqual(envs);
  });
});

describe("getEnvironmentById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
  });

  it("возвращает среду по ID", async () => {
    const env = { id: "1", name: "Работа" };
    selectChain.where.mockResolvedValue([env]);
    const result = await getEnvironmentById("1");
    expect(result).toEqual(env);
  });

  it("возвращает null если среда не найдена", async () => {
    selectChain.where.mockResolvedValue([]);
    const result = await getEnvironmentById("999");
    expect(result).toBeNull();
  });
});

describe("createEnvironment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
    mockDb.insert.mockReturnValue(insertChain);
    insertChain.values.mockReturnValue(insertChain);
  });

  it("создаёт среду с правильной позицией", async () => {
    // getEnvironments возвращает существующие
    selectChain.orderBy.mockResolvedValue([
      { id: "1", name: "Работа", position: 0 },
    ]);
    const env = { id: "2", name: "Личное", color: "#3b82f6", position: 1 };
    insertChain.returning.mockResolvedValue([env]);
    const result = await createEnvironment("Личное", "#3b82f6");
    expect(result).toEqual(env);
  });

  it("создаёт первую среду с позицией 0", async () => {
    selectChain.orderBy.mockResolvedValue([]);
    const env = { id: "1", name: "Работа", color: "#10b981", position: 0 };
    insertChain.returning.mockResolvedValue([env]);
    const result = await createEnvironment("Работа", "#10b981");
    expect(result).toEqual(env);
  });
});

describe("updateEnvironment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.update.mockReturnValue(updateChain);
    updateChain.set.mockReturnValue(updateChain);
    updateChain.where.mockReturnValue(updateChain);
  });

  it("обновляет название среды", async () => {
    const env = { id: "1", name: "Обновлённая" };
    updateChain.returning.mockResolvedValue([env]);
    const result = await updateEnvironment("1", { name: "Обновлённая" });
    expect(result).toEqual(env);
  });
});

describe("deleteEnvironment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
    mockDb.delete.mockReturnValue(deleteChain);
  });

  it("не удаляет последнюю среду", async () => {
    selectChain.orderBy.mockResolvedValue([{ id: "1", name: "Единственная" }]);
    const result = await deleteEnvironment("1");
    expect(result.error).toBeDefined();
  });

  it("удаляет среду если их больше одной", async () => {
    selectChain.orderBy.mockResolvedValue([
      { id: "1", name: "Работа" },
      { id: "2", name: "Личное" },
    ]);
    deleteChain.where.mockResolvedValue(undefined);
    const result = await deleteEnvironment("1");
    expect(result.error).toBeUndefined();
  });
});

describe("getActiveEnvironment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
  });

  it("возвращает среду по cookie", async () => {
    const env = { id: "1", name: "Работа" };
    selectChain.where.mockResolvedValue([env]);
    const result = await getActiveEnvironment("1");
    expect(result).toEqual(env);
  });

  it("возвращает первую среду если cookie пуст", async () => {
    const envs = [{ id: "1", name: "Работа", position: 0 }];
    selectChain.orderBy.mockResolvedValue(envs);
    const result = await getActiveEnvironment(undefined);
    expect(result).toEqual(envs[0]);
  });

  it("возвращает первую среду если cookie указывает на несуществующую", async () => {
    selectChain.where.mockResolvedValue([]);
    const envs = [{ id: "1", name: "Работа", position: 0 }];
    selectChain.orderBy.mockResolvedValue(envs);
    const result = await getActiveEnvironment("deleted-id");
    expect(result).toEqual(envs[0]);
  });
});
