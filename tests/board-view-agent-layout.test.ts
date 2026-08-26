import { describe, it, expect } from "vitest";
import { AGENT_LAYOUTS, isAgentLayout } from "@/hooks/use-board-view";

describe("раскладка агента", () => {
  it("знает обе раскладки", () => {
    expect(AGENT_LAYOUTS).toEqual(["dock", "panel"]);
  });

  it("чужое значение из localStorage не принимается", () => {
    expect(isAgentLayout("dock")).toBe(true);
    expect(isAgentLayout("panel")).toBe(true);
    expect(isAgentLayout("справа")).toBe(false);
    expect(isAgentLayout(undefined)).toBe(false);
  });
});
