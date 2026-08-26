"use client";

/**
 * ПРОТОТИП. Две раскладки агента на одной и той же переписке:
 * «снизу» — лента разворачивается вверх от инпута, доска видна за ней;
 * «справа» — панель во всю высоту, доска остаётся слева.
 *
 * Переключатель нужен, чтобы выбрать форму глазами, а не по описанию.
 * Ничего не сохраняет: «Применить» — это тост, а не запрос в базу.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronDown, Mic, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SparkleIcon } from "./sparkle-icon";
import { ThinkingLine, ThoughtFor, ToolTrace } from "./tool-trace";
import { useBoardView } from "@/hooks/use-board-view";
import {
  respond,
  SUGGESTIONS,
  type AgentBlock,
  type ChatMessage,
  type MockTask,
} from "./mock-engine";

let counter = 0;
const nextId = () => `m${++counter}`;

type ApplyState = "idle" | "applying" | "applied";

function Block({ block, done }: { block: AgentBlock; done: boolean }) {
  const [apply, setApply] = useState<ApplyState>("idle");

  // Применение — это тоже вызов инструмента, и он показывается так же,
  // как чтение доски: тем же следом, только пишущим.
  function applyWith(message: string) {
    setApply("applying");
    setTimeout(() => {
      setApply("applied");
      toast.success(message);
    }, 900);
  }

  if (block.kind === "tools") return <ToolTrace steps={block.steps} running={!done} />;

  if (block.kind === "text")
    return <p className="whitespace-pre-wrap text-sm leading-relaxed">{block.text}</p>;

  if (block.kind === "tasks")
    return (
      <div className="rounded-xl border border-border/60 bg-background/45 p-3">
        <div className="mb-2 text-xs text-muted-foreground">{block.caption}</div>
        <ul className="flex flex-col gap-1.5">
          {block.items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/60" />
              <span className="flex-1">
                {item.title}
                {item.meta && (
                  <span className="ml-2 text-xs text-muted-foreground">{item.meta}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center gap-2">
          {apply === "idle" ? (
            <>
              <button
                type="button"
                onClick={() => applyWith("Мок: на доске ничего не поменялось")}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
              >
                {block.confirm}
              </button>
              <button
                type="button"
                className="rounded-lg border px-3 py-1.5 text-xs text-muted-foreground"
              >
                Поправить
              </button>
            </>
          ) : (
            <ToolTrace
              steps={[
                {
                  tool: "create_task",
                  args: `{ title: "${block.items[0]?.title ?? ""}", columnId: "col_backlog" } ×${block.items.length}`,
                  result: `${block.items.length} задач`,
                },
              ]}
              running={apply === "applying"}
            />
          )}
        </div>
      </div>
    );

  return (
    <div className="rounded-xl border border-border/60 bg-background/45 p-3">
      <div className="mb-2 text-xs text-muted-foreground">{block.caption}</div>
      <ul className="flex flex-col gap-2">
        {block.items.map((item, i) => (
          <li key={i} className="text-sm">
            <div className="text-muted-foreground line-through decoration-muted-foreground/40">
              {item.from}
            </div>
            <div className="font-medium">{item.to}</div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-2">
        {apply === "idle" ? (
          <>
            <button
              type="button"
              onClick={() => applyWith("Мок: названия остались прежними")}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              {block.confirm}
            </button>
            <button
              type="button"
              className="rounded-lg border px-3 py-1.5 text-xs text-muted-foreground"
            >
              По одной
            </button>
          </>
        ) : (
          <ToolTrace
            steps={[
              {
                tool: "update_task",
                args: `{ id: "…", title: "${block.items[0]?.to ?? ""}" } ×${block.items.length}`,
                result: `${block.items.length} задач`,
              },
            ]}
            running={apply === "applying"}
          />
        )}
      </div>
    </div>
  );
}

function Transcript({ messages }: { messages: ChatMessage[] }) {
  const end = useRef<HTMLDivElement>(null);

  // Лента растёт вниз, а смотрят всегда на последний ответ.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex flex-col gap-4">
      {messages.map((message) =>
        message.role === "user" ? (
          <div key={message.id} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3 py-2 text-sm">
              {message.text}
            </div>
          </div>
        ) : (
          <div key={message.id} className="flex gap-2.5">
            {/* Кружок ровно в высоту первой строки (20px) — искра встаёт по её середине. */}
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <SparkleIcon className="size-3 text-primary" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-2.5">
              {message.thoughtMs && <ThoughtFor ms={message.thoughtMs} />}
              {message.blocks.map((block, i) => (
                <Block key={i} block={block} done={!message.thinking} />
              ))}
              {message.thinking && message.blocks.length === 0 && <ThinkingLine />}
            </div>
          </div>
        )
      )}
      <div ref={end} />
    </div>
  );
}

function Composer({
  onSend,
  onFocusChange,
}: {
  onSend: (text: string) => void;
  onFocusChange?: (focused: boolean) => void;
}) {
  const [text, setText] = useState("");
  const hasText = text.trim().length > 0;

  function send() {
    if (!hasText) return;
    onSend(text.trim());
    setText("");
  }

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card/60 p-3 backdrop-blur-md transition-all",
        hasText && "border-primary ring-[3px] ring-primary/10"
      )}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        placeholder="Спроси про доску или опиши задачи…"
        rows={1}
        className="w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        style={{ minHeight: "24px", maxHeight: "120px" }}
        onInput={(e) => {
          const target = e.target as HTMLTextAreaElement;
          target.style.height = "24px";
          target.style.height = `${target.scrollHeight}px`;
        }}
      />
      <div className="flex items-center justify-end gap-2">
        <button type="button" className="text-muted-foreground hover:text-foreground">
          <Mic className="size-4" />
        </button>
        <button
          type="button"
          onClick={send}
          disabled={!hasText}
          className={cn(
            "flex size-8 items-center justify-center rounded-full transition-colors",
            hasText ? "bg-primary text-primary-foreground" : "bg-muted-foreground/30 text-white"
          )}
        >
          <ArrowUp className="size-4" />
        </button>
      </div>
    </div>
  );
}

/** Первая строка последнего ответа — она и остаётся видна в свёрнутом виде. */
function lastLine(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "user") return message.text;
    const text = message.blocks.find((b) => b.kind === "text");
    if (text && text.kind === "text") return text.text.split("\n")[0];
  }
  return "";
}

interface AgentMockProps {
  tasks: MockTask[];
}

export function AgentMock({ tasks }: AgentMockProps) {
  const { agentLayout } = useBoardView();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Курсор ушёл с панели — сворачиваем. Но не тогда, когда в неё печатают.
  const typing = useRef(false);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const send = useCallback(
    (text: string) => {
      const answerId = nextId();
      setCollapsed(false);
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "user", text },
        { id: answerId, role: "agent", blocks: [], thinking: true },
      ]);

      const blocks = respond(text, tasks, new Date());
      const head = blocks[0]?.kind === "tools" ? [blocks[0]] : [];

      timers.current.push(
        setTimeout(() => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === answerId && m.role === "agent" ? { ...m, blocks: head } : m
            )
          );
        }, 350),
        setTimeout(() => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === answerId && m.role === "agent"
                ? { ...m, blocks, thinking: false, thoughtMs: 1100 }
                : m
            )
          );
        }, 1100)
      );
    },
    [tasks]
  );

  const empty = messages.length === 0;

  const suggestions = (
    <div className="flex flex-wrap gap-1.5">
      {SUGGESTIONS.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => send(s)}
          className="rounded-full border border-border/60 bg-card/60 px-2.5 py-1 text-xs text-muted-foreground backdrop-blur-md transition-colors hover:text-foreground"
        >
          {s}
        </button>
      ))}
    </div>
  );

  if (agentLayout === "panel") {
    return (
      <div className="fixed right-4 top-[72px] bottom-4 z-40 hidden w-[380px] flex-col rounded-2xl border bg-card shadow-lg md:flex">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <SparkleIcon className="size-3.5 text-primary" /> Агент
          </span>
          {!empty && (
            <button
              type="button"
              onClick={() => setMessages([])}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Очистить переписку"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {empty ? (
            <div className="flex h-full flex-col justify-end gap-3">
              <p className="text-sm text-muted-foreground">
                Спроси про доску, надиктуй задачи или попроси переписать формулировку.
              </p>
              {suggestions}
            </div>
          ) : (
            <Transcript messages={messages} />
          )}
        </div>
        <div className="p-3 pt-0">
          <Composer onSend={send} />
        </div>
      </div>
    );
  }

  return (
    // Полоса тянется во всю ширину, поэтому клики мимо ленты обязаны проходить
    // сквозь неё на доску — иначе агент съедает нижний ряд карточек.
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 hidden md:block">
      <div
        className="pointer-events-auto mx-auto w-full max-w-[680px] px-4 pb-4"
        onMouseEnter={() => setCollapsed(false)}
        onMouseLeave={() => {
          if (!typing.current) setCollapsed(true);
        }}
      >
        {!empty && collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="mb-2 flex w-full items-center gap-2 rounded-full border border-border/60 bg-card/50 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur-md"
          >
            <SparkleIcon className="size-3 shrink-0 text-primary" />
            <span className="flex-1 truncate text-left">{lastLine(messages)}</span>
            <span className="shrink-0 opacity-70">развернуть</span>
          </button>
        )}

        {!empty && !collapsed && (
          <div className="mb-2 flex max-h-[52vh] flex-col rounded-2xl border border-border/60 bg-card/45 shadow-lg backdrop-blur-md">
            {/* Шапка вне прокрутки: крестик виден на любой длине переписки. */}
            <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-2">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <SparkleIcon className="size-3 text-primary" /> Агент
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCollapsed(true)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Свернуть"
                >
                  <ChevronDown className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setMessages([])}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Очистить переписку"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <Transcript messages={messages} />
            </div>
          </div>
        )}

        {empty && <div className="mb-2 flex justify-end">{suggestions}</div>}

        <Composer
          onSend={send}
          onFocusChange={(focused) => {
            typing.current = focused;
            if (focused) setCollapsed(false);
          }}
        />
      </div>
    </div>
  );
}
