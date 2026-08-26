import { describe, it, expect } from "vitest";
import {
  AGENT_UNAVAILABLE_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  fetchErrorMessage,
} from "@/lib/agent/friendly-error";

describe("fetchErrorMessage", () => {
  it("401 — сессия истекла, а не «модель недоступна»", () => {
    expect(fetchErrorMessage(401)).toBe(SESSION_EXPIRED_MESSAGE);
  });

  it("остальные статусы — общая человеческая формулировка", () => {
    expect(fetchErrorMessage(500)).toBe(AGENT_UNAVAILABLE_MESSAGE);
    expect(fetchErrorMessage(429)).toBe(AGENT_UNAVAILABLE_MESSAGE);
    expect(fetchErrorMessage(0)).toBe(AGENT_UNAVAILABLE_MESSAGE);
  });
});
