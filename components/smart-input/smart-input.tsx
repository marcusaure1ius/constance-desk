"use client";

import { useState, useTransition, useRef, useCallback } from "react";
import { Mic, ArrowUp, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useVoiceRecorder } from "./voice-recorder";
import { TaskPreview } from "./task-preview";
import { createTasksBatchAction } from "@/lib/actions/tasks";
import { parseTasksAction } from "@/lib/actions/smart-input";
import type { ParsedTask } from "@/lib/services/groq";

const WAVEFORM_BARS = Array.from({ length: 14 }, () => ({
  height: 8 + Math.random() * 20,
  opacity: 0.5 + Math.random() * 0.5,
}));

type SmartInputState = "idle" | "parsing" | "preview";

interface SmartInputProps {
  defaultColumnId: string;
  onDone?: () => void;
}

export function SmartInput({ defaultColumnId, onDone }: SmartInputProps) {
  const [text, setText] = useState("");
  const [state, setState] = useState<SmartInputState>("idle");
  const [parsedTasks, setParsedTasks] = useState<ParsedTask[]>([]);
  const [sourceText, setSourceText] = useState("");
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleParse = useCallback(async (inputText?: string) => {
    const textToParse = inputText ?? text;
    if (!textToParse.trim()) return;

    setSourceText(textToParse);
    setState("parsing");

    try {
      const tasks = await parseTasksAction(textToParse);

      if (tasks.length === 0) {
        toast.error("Не удалось разобрать задачи из текста");
        setState("idle");
        return;
      }

      setParsedTasks(tasks);
      setState("preview");
    } catch {
      toast.error("Ошибка при разборе задач");
      setState("idle");
    }
  }, [text]);

  const recorder = useVoiceRecorder(
    (transcription) => {
      setText(transcription);
      handleParse(transcription);
    },
    (error) => toast.error(error)
  );

  function handleSubmit() {
    if (recorder.state === "recording") {
      recorder.stop();
      return;
    }
    handleParse();
  }

  function handleConfirm(tasks: ParsedTask[]) {
    startTransition(async () => {
      try {
        const inputs = tasks.map((t) => ({
          title: t.title,
          columnId: defaultColumnId,
          priority: t.priority ?? ("normal" as const),
          plannedDate: t.plannedDate,
        }));

        await createTasksBatchAction(inputs);
        const n = tasks.length;
        const mod10 = n % 10;
        const mod100 = n % 100;
        const word = mod10 === 1 && mod100 !== 11 ? "задача" : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20) ? "задачи" : "задач";
        toast.success(`Добавлено ${n} ${word}`);
        setText("");
        setParsedTasks([]);
        setState("idle");
        onDone?.();
      } catch {
        toast.error("Не удалось создать задачи");
      }
    });
  }

  function handleCancel() {
    setState("idle");
    setParsedTasks([]);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const hasText = text.trim().length > 0;
  const isRecording = recorder.state === "recording";
  const isTranscribing = recorder.state === "transcribing";
  const isParsing = state === "parsing";
  const isPreview = state === "preview";

  if (isPreview) {
    return (
      <div className="mx-auto w-full max-w-[680px] px-4 pb-4">
        <TaskPreview
          tasks={parsedTasks}
          sourceText={sourceText}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          isPending={isPending}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[680px] px-4 pb-4">
      <div
        className={cn(
          "rounded-2xl border bg-card p-3 transition-all",
          isRecording && "border-red-500 ring-[3px] ring-red-500/10",
          (hasText || isParsing) && !isRecording && "border-primary ring-[3px] ring-primary/10",
        )}
      >
        {/* Recording state */}
        {isRecording && (
          <div className="flex items-center gap-3 py-2">
            <div className="size-3 animate-pulse rounded-full bg-red-500" />
            <span className="text-sm text-foreground">Запись... {recorder.formattedDuration}</span>
            <div className="flex flex-1 items-center gap-0.5 px-4">
              {WAVEFORM_BARS.map((bar, i) => (
                <div
                  key={i}
                  className="w-[3px] rounded-full bg-red-500"
                  style={{ height: `${bar.height}px`, opacity: bar.opacity }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Parsing state */}
        {isParsing && (
          <div className="py-2">
            <div className="mb-2 text-sm text-muted-foreground/60">{sourceText}</div>
            <div className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span className="text-sm text-primary">Разбираю на задачи...</span>
            </div>
          </div>
        )}

        {/* Transcribing state */}
        {isTranscribing && (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Распознаю речь...</span>
          </div>
        )}

        {/* Text input */}
        {!isRecording && !isParsing && !isTranscribing && (
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Опиши задачи или вставь текст из чата..."
            rows={1}
            className="w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            style={{ minHeight: "24px", maxHeight: "120px" }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "24px";
              target.style.height = target.scrollHeight + "px";
            }}
          />
        )}

        {/* Buttons */}
        <div className="flex items-center justify-between">
          {isRecording ? (
            <span className="text-xs text-muted-foreground">Нажми ещё раз чтобы остановить</span>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-2">
            {!isParsing && !isTranscribing && (
              <button
                type="button"
                onClick={isRecording ? recorder.stop : recorder.start}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {isRecording ? (
                  <Square className="size-4 fill-red-500 text-red-500" />
                ) : (
                  <Mic className="size-4" />
                )}
              </button>
            )}

            {!isRecording && !isParsing && !isTranscribing && (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!hasText}
                className={cn(
                  "flex size-8 items-center justify-center rounded-full transition-colors",
                  hasText ? "bg-primary text-primary-foreground" : "bg-muted-foreground/30 text-white"
                )}
              >
                <ArrowUp className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
