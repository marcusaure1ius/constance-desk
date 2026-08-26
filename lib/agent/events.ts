/**
 * События агента — то, что видит браузер, пока цикл идёт на сервере.
 *
 * Формат — NDJSON: по событию на строку. Не SSE, потому что ничего из SSE
 * (id, retry, именованные события) здесь не нужно, а разбор строк короче.
 */

export type AgentEvent =
  | { type: "thinking" }
  | { type: "tool_start"; id: string; tool: string; args: unknown }
  | { type: "tool_end"; id: string; tool: string; result?: string; error?: string }
  | { type: "text"; text: string }
  | { type: "proposal"; id: string; calls: { tool: string; args: unknown }[] }
  | { type: "error"; message: string };

export function encodeEvent(event: AgentEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/**
 * Разборщик потока. Держит хвост между вызовами: чанк рвётся где угодно,
 * в том числе посередине имени поля.
 */
export function createEventParser(): (chunk: string) => AgentEvent[] {
  let tail = "";

  return (chunk: string) => {
    const lines = (tail + chunk).split("\n");
    tail = lines.pop() ?? "";

    const events: AgentEvent[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as AgentEvent);
      } catch {
        // Битая строка — пропускаем: ради неё ронять ленту незачем.
      }
    }
    return events;
  };
}
