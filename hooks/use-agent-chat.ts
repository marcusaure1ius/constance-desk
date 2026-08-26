"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createEventParser, type AgentEvent } from "@/lib/agent/events";
import type { DeferredCall } from "@/lib/agent/apply";
import { toHistoryMessages } from "@/lib/agent/history";
import { AGENT_UNAVAILABLE_MESSAGE, fetchErrorMessage } from "@/lib/agent/friendly-error";
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
      /** Вопрос пользователя, на который отвечает эта запись — нужен кнопке «Повторить». */
      question: string;
      steps: TraceStep[];
      text?: string;
      proposal?: DeferredCall[];
      /**
       * Итог применения предложения. Живёт в записи, а не в состоянии карточки:
       * карточка пересоздаётся при перерисовке ленты, и локальный флаг «уже
       * применено» терялся — кнопка снова предлагала создать то, что создано.
       */
      applied?: { applied: number; failed: { tool: string; error: string }[] };
      thinking: boolean;
      error?: string;
    };

let counter = 0;
const nextId = () => `e${++counter}`;

export function useAgentChat(environmentId: string) {
  const router = useRouter();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const answerId = useRef<string>("");
  // Растёт на board_changed и на применении предложения — признак для
  // components/agent/agent-chat.tsx, что подсказки-чипсы устарели и нужно
  // собрать их заново при следующем фокусе в поле.
  const [boardVersion, setBoardVersion] = useState(0);

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
          entry.steps.push({ id: event.id, tool: event.tool, args: JSON.stringify(event.args) });
        });
        return;
      }

      if (event.type === "tool_end") {
        patch((entry) => {
          const step = entry.steps.find((s) => s.id === event.id);
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

      if (event.type === "board_changed") {
        // Инструменты реестра зовут сервисы напрямую и про Next.js не знают:
        // без этого доска простоит на месте до ручной перезагрузки страницы.
        router.refresh();
        setBoardVersion((v) => v + 1);
        return;
      }

      // event.type === "error" — сырой текст провайдера остаётся в консоли,
      // в ленте — человеческая формулировка с кнопкой «Повторить».
      console.error("[agent]", event.message);
      patch((entry) => {
        entry.error = AGENT_UNAVAILABLE_MESSAGE;
      });
    },
    [patch, router]
  );

  const send = useCallback(
    async (text: string) => {
      const id = nextId();
      answerId.current = id;
      setBusy(true);
      const history = toHistoryMessages(entries);
      setEntries((prev) => [
        ...prev,
        { id: nextId(), role: "user", text },
        { id, role: "agent", question: text, steps: [], thinking: true },
      ]);

      try {
        const response = await fetch("/api/agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, environmentId, history }),
        });

        if (!response.ok || !response.body) {
          patch((entry) => {
            entry.error = fetchErrorMessage(response.status);
          });
          return;
        }

        const parse = createEventParser();
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const event of parse(value)) apply(event);
        }
      } catch (error) {
        console.error("[agent]", error);
        patch((entry) => {
          entry.error = AGENT_UNAVAILABLE_MESSAGE;
        });
      } finally {
        patch((entry) => {
          entry.thinking = false;
          // Ход завершился без единого события (пустой ответ модели, обрыв по
          // таймауту) — без этого в ленте остаётся пустой пузырь без объяснения.
          if (!entry.text && !entry.proposal && !entry.error) {
            entry.error = AGENT_UNAVAILABLE_MESSAGE;
          }
        });
        setBusy(false);
      }
    },
    [apply, entries, environmentId, patch]
  );

  const clear = useCallback(() => setEntries([]), []);

  const markApplied = useCallback(
    (entryId: string, result: { applied: number; failed: { tool: string; error: string }[] }) => {
      setEntries((prev) =>
        prev.map((entry) =>
          entry.id === entryId && entry.role === "agent" ? { ...entry, applied: result } : entry
        )
      );
      setBoardVersion((v) => v + 1);
    },
    []
  );

  return { entries, send, clear, busy, markApplied, boardVersion };
}
