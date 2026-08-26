"use client";

import { useCallback, useRef, useState } from "react";
import { createEventParser, type AgentEvent } from "@/lib/agent/events";
import type { DeferredCall } from "@/lib/agent/apply";
import type { TraceStep } from "@/components/agent/tool-trace";

/**
 * Лента разговора: POST в роут агента и чтение потока NDJSON.
 *
 * Состояние собирается из событий, а не из финального ответа: пользователь
 * должен видеть, что агент читает доску, пока он её читает.
 */

export type ChatEntry =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "agent";
      steps: TraceStep[];
      text?: string;
      proposal?: DeferredCall[];
      thinking: boolean;
      error?: string;
    };

let counter = 0;
const nextId = () => `e${++counter}`;

export function useAgentChat(environmentId: string) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const answerId = useRef<string>("");

  const patch = useCallback((update: (entry: Extract<ChatEntry, { role: "agent" }>) => void) => {
    setEntries((prev) =>
      prev.map((entry) => {
        if (entry.id !== answerId.current || entry.role !== "agent") return entry;
        const copy = { ...entry, steps: [...entry.steps] };
        update(copy);
        return copy;
      })
    );
  }, []);

  const apply = useCallback(
    (event: AgentEvent) => {
      if (event.type === "thinking") return;

      if (event.type === "tool_start") {
        patch((entry) => {
          entry.steps.push({ tool: event.tool, args: JSON.stringify(event.args) });
        });
        return;
      }

      if (event.type === "tool_end") {
        patch((entry) => {
          const step = entry.steps.find((s) => s.tool === event.tool && !s.result);
          if (step) step.result = event.error ?? event.result;
        });
        return;
      }

      if (event.type === "text") {
        patch((entry) => {
          entry.text = event.text;
        });
        return;
      }

      if (event.type === "proposal") {
        patch((entry) => {
          entry.proposal = event.calls;
        });
        return;
      }

      patch((entry) => {
        entry.error = event.message;
      });
    },
    [patch]
  );

  const send = useCallback(
    async (text: string) => {
      const id = nextId();
      answerId.current = id;
      setBusy(true);
      setEntries((prev) => [
        ...prev,
        { id: nextId(), role: "user", text },
        { id, role: "agent", steps: [], thinking: true },
      ]);

      try {
        const response = await fetch("/api/agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, environmentId }),
        });

        if (!response.ok || !response.body) {
          throw new Error("Агент недоступен");
        }

        const parse = createEventParser();
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const event of parse(value)) apply(event);
        }
      } catch (error) {
        apply({
          type: "error",
          message: error instanceof Error ? error.message : "Агент недоступен",
        });
      } finally {
        patch((entry) => {
          entry.thinking = false;
        });
        setBusy(false);
      }
    },
    [apply, environmentId, patch]
  );

  const clear = useCallback(() => setEntries([]), []);

  return { entries, send, clear, busy };
}
