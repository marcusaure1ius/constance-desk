import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDb, selectChain, updateChain } = vi.hoisted(() => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn(),
  };
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn(),
  };
  const mockDb = {
    select: vi.fn(() => selectChain),
    update: vi.fn(() => updateChain),
  };
  return { mockDb, selectChain, updateChain };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    })
  ),
}));

import { isPinSet, verifyPin, getNickname, setNickname } from "@/lib/services/auth";

describe("isPinSet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
  });

  it("возвращает true если PIN установлен", async () => {
    selectChain.where.mockResolvedValue([{ pinHash: "$2a$10$hash" }]);
    const result = await isPinSet();
    expect(result).toBe(true);
  });

  it("возвращает false если PIN не установлен", async () => {
    selectChain.where.mockResolvedValue([{ pinHash: null }]);
    const result = await isPinSet();
    expect(result).toBe(false);
  });

  it("возвращает false если записи нет", async () => {
    selectChain.where.mockResolvedValue([]);
    const result = await isPinSet();
    expect(result).toBe(false);
  });
});

describe("verifyPin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
  });

  it("возвращает false если PIN не установлен", async () => {
    selectChain.where.mockResolvedValue([{ pinHash: null }]);
    const result = await verifyPin("1234");
    expect(result).toBe(false);
  });

  it("возвращает false если записи нет", async () => {
    selectChain.where.mockResolvedValue([]);
    const result = await verifyPin("1234");
    expect(result).toBe(false);
  });
});

describe("getNickname", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectChain);
    selectChain.from.mockReturnValue(selectChain);
  });

  it("возвращает ник если он установлен", async () => {
    selectChain.where.mockResolvedValue([{ nickname: "Алиса" }]);
    const result = await getNickname();
    expect(result).toBe("Алиса");
  });

  it("возвращает null если ника нет", async () => {
    selectChain.where.mockResolvedValue([{ nickname: null }]);
    const result = await getNickname();
    expect(result).toBeNull();
  });

  it("возвращает null если записи нет", async () => {
    selectChain.where.mockResolvedValue([]);
    const result = await getNickname();
    expect(result).toBeNull();
  });
});

describe("setNickname", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.update.mockReturnValue(updateChain);
    updateChain.set.mockReturnValue(updateChain);
  });

  it("обновляет ник", async () => {
    updateChain.where.mockResolvedValue(undefined);
    await expect(setNickname("Боб")).resolves.not.toThrow();
    expect(mockDb.update).toHaveBeenCalled();
  });
});
