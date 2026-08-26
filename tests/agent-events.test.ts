import { describe, it, expect } from "vitest";
import { createEventParser, encodeEvent, type AgentEvent } from "@/lib/agent/events";

describe("encodeEvent", () => {
  it("кладёт по событию на строку", () => {
    expect(encodeEvent({ type: "thinking" })).toBe('{"type":"thinking"}\n');
  });
});

describe("createEventParser", () => {
  it("собирает событие, разрезанное между чанками", () => {
    const parse = createEventParser();
    expect(parse('{"type":"thi')).toEqual([]);
    expect(parse('nking"}\n')).toEqual([{ type: "thinking" }]);
  });

  it("отдаёт несколько событий из одного чанка", () => {
    const parse = createEventParser();
    const events: AgentEvent[] = [
      { type: "tool_start", id: "1", tool: "get_board", args: {} },
      { type: "text", text: "готово" },
    ];

    expect(parse(events.map(encodeEvent).join(""))).toEqual(events);
  });

  it("битую строку пропускает, следующую разбирает", () => {
    const parse = createEventParser();
    expect(parse('не json\n{"type":"thinking"}\n')).toEqual([{ type: "thinking" }]);
  });

  it("не отдаёт хвост без перевода строки дважды", () => {
    const parse = createEventParser();
    parse('{"type":"thinking"}\n{"type":"te');
    expect(parse('xt","text":"а"}\n')).toEqual([{ type: "text", text: "а" }]);
  });
});
