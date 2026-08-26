"use client";

/**
 * Лента разговора с агентом на настоящей модели.
 *
 * Две раскладки на одной и той же переписке: «снизу» — лента разворачивается
 * вверх от инпута, доска видна за ней; «справа» — панель во всю высоту, доска
 * остаётся слева. Переключатель — настройка «Доска» (`agentLayout`).
 */

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronDown, Loader2, Mic, Square, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SparkleIcon } from "./sparkle-icon";
import { ThinkingLine, ToolTrace } from "./tool-trace";
import { useBoardView } from "@/hooks/use-board-view";
import { useAgentChat, type ChatEntry } from "@/hooks/use-agent-chat";
import { useVoiceRecorder } from "@/components/smart-input/voice-recorder";
import { applyAgentCallsAction, suggestChipsAction } from "@/lib/actions/agent";
import type { DeferredCall } from "@/lib/agent/apply";
import { parseRichText, firstBlockPlainText, type InlineNode } from "@/lib/agent/rich-text";

/**
 * Откат, пока подсказки-чипсы ещё не собраны моделью по доске (первый рендер,
 * запрос в процессе) или модель ничего дельного не предложила. Пользователь не
 * должен видеть пустоту или спиннер вместо чипсов — см. `lib/llm/suggest-chips.ts`.
 */
const FALLBACK_SUGGESTIONS = [
  "Что у меня горит?",
  "Разбей «сделать демку» на шаги",
  "Почисти формулировки в бэклоге",
];

function pluralActions(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "действие";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "действия";
  return "действий";
}

/**
 * Читаемая строка предложения — берём то, что действительно есть в аргументах.
 * `label` заполняется на сервере (`lib/agent/loop.ts`) из уже прочитанных
 * задач и приоритетнее: он знает название задачи по id, здесь его нет.
 */
function describeCall(call: DeferredCall): string {
  if (call.label) return call.label;

  const args = (call.args && typeof call.args === "object" ? call.args : {}) as Record<
    string,
    unknown
  >;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);

  switch (call.tool) {
    case "create_task": {
      const title = str(args.title) ?? "без названия";
      const date = str(args.plannedDate);
      return `Создать «${title}»${date ? ` · срок ${date}` : ""}`;
    }
    case "create_epic_task": {
      const title = str(args.title) ?? "без названия";
      const epic = str(args.epicName);
      return `Создать «${title}»${epic ? ` в эпике «${epic}»` : ""}`;
    }
    case "create_epic": {
      const name = str(args.name) ?? "без названия";
      return `Создать эпик «${name}»`;
    }
    case "update_task": {
      const title = str(args.title);
      return title ? `Переименовать в «${title}»` : "Изменить задачу";
    }
    case "delete_task":
      return "Удалить задачу";
    default:
      return `${call.tool}: ${JSON.stringify(call.args)}`;
  }
}

type ApplyResult = { applied: number; failed: { tool: string; error: string }[] };

/**
 * Карточка предложения: показывает, что именно агент хочет создать или изменить.
 *
 * Итог применения хранит не карточка, а запись ленты: карточка пересоздаётся
 * при перерисовке, и локальный флаг «уже применено» пропадал — кнопка снова
 * предлагала создать то, что уже создано, а повторное нажатие делало дубль.
 */
function ProposalCard({
  calls,
  applied,
  onApplied,
}: {
  calls: DeferredCall[];
  applied?: ApplyResult;
  onApplied: (result: ApplyResult) => void;
}) {
  const [applying, setApplying] = useState(false);

  async function apply() {
    if (applying || applied) return;
    setApplying(true);
    try {
      const result = await applyAgentCallsAction(calls);
      onApplied(result);
      if (result.failed.length === 0) {
        toast.success(`Применено: ${result.applied} из ${calls.length}`);
      } else {
        toast.error(
          `Применено ${result.applied} из ${calls.length}. Не вышло: ${result.failed
            .map((f) => f.error)
            .join("; ")}`
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось применить");
    } finally {
      setApplying(false);
    }
  }

  const sameTool = calls.every((c) => c.tool === calls[0]?.tool);

  return (
    <div className="rounded-xl border border-border/60 bg-background/45 p-3">
      <div className="mb-2 text-xs text-muted-foreground">
        {calls.length} {pluralActions(calls.length)}
      </div>
      <ul className="flex flex-col gap-1.5">
        {calls.map((call, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/60" />
            <span className="flex-1">{describeCall(call)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-2">
        {!applied && !applying ? (
          <button
            type="button"
            onClick={apply}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            Применить
          </button>
        ) : (
          <ToolTrace
            steps={[
              {
                tool: sameTool ? calls[0]?.tool ?? "" : "",
                args: `×${calls.length}`,
                result: applied
                  ? `${applied.applied} из ${calls.length}${
                      applied.failed.length > 0 ? `, ошибок: ${applied.failed.length}` : ""
                    }`
                  : undefined,
              },
            ]}
            running={applying}
          />
        )}
      </div>
    </div>
  );
}

/** Один инлайн-фрагмент текста ответа: жирный/курсив/код или обычный текст. */
function InlineSpan({ node }: { node: InlineNode }) {
  if (node.type === "bold") return <span className="font-medium">{node.text}</span>;
  if (node.type === "italic") return <em>{node.text}</em>;
  if (node.type === "code")
    return (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{node.text}</code>
    );
  return <>{node.text}</>;
}

/**
 * Текст ответа модели с тем немногим из Markdown, чем она реально пользуется:
 * жирный, курсив, код, списки, заголовки как жирная строка. Разбор в
 * `lib/agent/rich-text.ts`, здесь только отрисовка — тихая, в языке ленты.
 */
function RichText({ text }: { text: string }) {
  const blocks = parseRichText(text);
  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed">
      {blocks.map((block, i) => {
        if (block.type === "heading")
          return (
            <p key={i} className="whitespace-pre-wrap font-medium">
              {block.inline.map((node, j) => (
                <InlineSpan key={j} node={node} />
              ))}
            </p>
          );
        if (block.type === "list")
          return (
            <ul key={i} className="flex flex-col gap-1">
              {block.items.map((item, j) => (
                <li key={j} className="flex items-start gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/60" />
                  <span className="flex-1">
                    {item.map((node, k) => (
                      <InlineSpan key={k} node={node} />
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          );
        return (
          <p key={i} className="whitespace-pre-wrap">
            {block.inline.map((node, j) => (
              <InlineSpan key={j} node={node} />
            ))}
          </p>
        );
      })}
    </div>
  );
}

function AgentEntryView({
  entry,
  onRetry,
  onApplied,
}: {
  entry: Extract<ChatEntry, { role: "agent" }>;
  onRetry: (text: string) => void;
  onApplied: (entryId: string, result: ApplyResult) => void;
}) {
  return (
    <div className="flex gap-2.5">
      {/* Кружок ровно в высоту первой строки (20px) — искра встаёт по её середине. */}
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <SparkleIcon className="size-3 text-primary" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        {entry.thinking && entry.steps.length === 0 && <ThinkingLine />}
        {entry.steps.length > 0 && <ToolTrace steps={entry.steps} running={entry.thinking} />}
        {entry.text && <RichText text={entry.text} />}
        {entry.proposal && entry.proposal.length > 0 && (
          <ProposalCard
            calls={entry.proposal}
            applied={entry.applied}
            onApplied={(result) => onApplied(entry.id, result)}
          />
        )}
        {entry.error && (
          <div className="flex items-center gap-2">
            <p className="text-xs text-destructive">{entry.error}</p>
            <button
              type="button"
              onClick={() => onRetry(entry.question)}
              className="text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              Повторить
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Transcript({
  entries,
  onRetry,
  onApplied,
}: {
  entries: ChatEntry[];
  onRetry: (text: string) => void;
  onApplied: (entryId: string, result: ApplyResult) => void;
}) {
  const end = useRef<HTMLDivElement>(null);

  // Лента растёт вниз, а смотрят всегда на последний ответ.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [entries]);

  return (
    <div className="flex flex-col gap-4">
      {entries.map((entry) =>
        entry.role === "user" ? (
          <div key={entry.id} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3 py-2 text-sm">
              {entry.text}
            </div>
          </div>
        ) : (
          <AgentEntryView key={entry.id} entry={entry} onRetry={onRetry} onApplied={onApplied} />
        )
      )}
      <div ref={end} />
    </div>
  );
}

function Composer({
  onSend,
  busy,
  onFocusChange,
  onFocus,
}: {
  onSend: (text: string) => void;
  busy: boolean;
  onFocusChange?: (focused: boolean) => void;
  /** Первый и любой следующий фокус в поле — триггер для сбора подсказок-чипсов. */
  onFocus?: () => void;
}) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const recorder = useVoiceRecorder(
    (transcription) => {
      setText((prev) => {
        const trimmed = prev.trim();
        return trimmed ? `${trimmed} ${transcription}` : transcription;
      });
      // Распознанное — только черновик: пользователь должен прочитать и
      // отправить сам, поэтому возвращаем фокус в поле, а не отправляем.
      textareaRef.current?.focus();
    },
    (error) => toast.error(error)
  );
  const isRecording = recorder.state === "recording";
  const isTranscribing = recorder.state === "transcribing";
  const voiceBusy = isRecording || isTranscribing;

  // Лента не должна сворачиваться по уходу курсора, пока идёт запись или
  // распознавание — так же, как она не сворачивается при фокусе в поле.
  const expanded = focused || voiceBusy;
  useEffect(() => {
    onFocusChange?.(expanded);
  }, [expanded, onFocusChange]);

  const hasText = text.trim().length > 0;
  const canSend = hasText && !busy && !voiceBusy;

  // Высота поля считается от значения, а не от события ввода: текст сюда
  // попадает и мимо клавиатуры — очищается после отправки и дописывается
  // распознанной речью, и в обоих случаях поле осталось бы прежней высоты.
  useEffect(() => {
    const field = textareaRef.current;
    if (!field) return;
    field.style.height = "24px";
    field.style.height = `${field.scrollHeight}px`;
  }, [text]);

  function send() {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
  }

  function handleMicClick() {
    if (isRecording) recorder.stop();
    else if (!isTranscribing) recorder.start();
  }

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card/60 p-3 backdrop-blur-md transition-all",
        hasText && !voiceBusy && "border-primary ring-[3px] ring-primary/10",
        isRecording && "border-destructive ring-[3px] ring-destructive/10"
      )}
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        onBlur={() => setFocused(false)}
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
      />
      {/* justify-end держит кнопки справа и в покое, когда строки состояния
          с её mr-auto в разметке нет. */}
      <div className="flex items-center justify-end gap-2">
        {isRecording && (
          <span className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-destructive" />
            Запись… {recorder.formattedDuration}
          </span>
        )}
        {isTranscribing && (
          <span className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 shrink-0 animate-spin" />
            Распознаю речь…
          </span>
        )}
        <button
          type="button"
          onClick={handleMicClick}
          disabled={isTranscribing}
          title={
            isRecording
              ? "Остановить запись"
              : isTranscribing
                ? "Распознаю речь…"
                : "Надиктовать текст"
          }
          aria-label={
            isRecording
              ? "Остановить запись"
              : isTranscribing
                ? "Распознаю речь"
                : "Надиктовать текст"
          }
          className={cn(
            "text-muted-foreground transition-colors",
            !isTranscribing && "hover:text-foreground",
            isTranscribing && "cursor-not-allowed opacity-60"
          )}
        >
          {isTranscribing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : isRecording ? (
            <Square className="size-4 fill-destructive text-destructive" />
          ) : (
            <Mic className="size-4" />
          )}
        </button>
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          className={cn(
            "flex size-8 items-center justify-center rounded-full transition-colors",
            canSend ? "bg-primary text-primary-foreground" : "bg-muted-foreground/30 text-white"
          )}
        >
          <ArrowUp className="size-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * Начало последнего ответа для свёрнутой плашки — без Markdown-разметки:
 * там нет блоков для её отрисовки, только обрезанная в одну строку CSS-строка.
 * Берём именно начало (первый блок), не весь ответ — плашка не пересказ.
 */
function lastLine(entries: ChatEntry[]): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.role === "user") return entry.text;
    if (entry.text) return firstBlockPlainText(entry.text);
    if (entry.error) return entry.error;
  }
  return "";
}

interface AgentChatProps {
  environmentId: string;
}

export function AgentChat({ environmentId }: AgentChatProps) {
  const { agentLayout } = useBoardView();
  const { entries, send, clear, busy, markApplied, boardVersion } = useAgentChat(environmentId);
  const [collapsed, setCollapsed] = useState(false);
  // Курсор ушёл с панели — сворачиваем. Но не тогда, когда в неё печатают.
  const typing = useRef(false);

  const [chips, setChips] = useState<string[]>(FALLBACK_SUGGESTIONS);
  // Версия доски, под которую уже запрошены (или запрашиваются) чипсы — не
  // даём фокусу дороже одного вызова модели на одну и ту же доску.
  const chipsRequestedFor = useRef(-1);

  const empty = entries.length === 0;

  function handleSend(text: string) {
    setCollapsed(false);
    send(text);
  }

  // Первый фокус в пустой ленте — собрать подсказки по текущей доске. Пока
  // ответа нет и если модель ничего не предложила — остаёмся на статичном
  // откате, а не показываем пустоту.
  function handleComposerFocus() {
    if (!empty || chipsRequestedFor.current === boardVersion) return;
    chipsRequestedFor.current = boardVersion;
    setChips(FALLBACK_SUGGESTIONS);
    suggestChipsAction(environmentId)
      .then((result) => setChips(result.length > 0 ? result : FALLBACK_SUGGESTIONS))
      .catch(() => setChips(FALLBACK_SUGGESTIONS));
  }

  const suggestions = (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => handleSend(s)}
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
              onClick={clear}
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
            <Transcript entries={entries} onRetry={handleSend} onApplied={markApplied} />
          )}
        </div>
        <div className="p-3 pt-0">
          <Composer onSend={handleSend} busy={busy} onFocus={handleComposerFocus} />
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
            <span className="flex-1 truncate text-left">{lastLine(entries)}</span>
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
                  onClick={clear}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Очистить переписку"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <Transcript entries={entries} onRetry={handleSend} onApplied={markApplied} />
            </div>
          </div>
        )}

        {empty && <div className="mb-2 flex justify-end">{suggestions}</div>}

        <Composer
          onSend={handleSend}
          busy={busy}
          onFocusChange={(focused) => {
            typing.current = focused;
            if (focused) setCollapsed(false);
          }}
          onFocus={handleComposerFocus}
        />
      </div>
    </div>
  );
}
