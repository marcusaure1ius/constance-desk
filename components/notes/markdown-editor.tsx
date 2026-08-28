"use client";

import * as React from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { livePreview } from "@/lib/notes/live-preview";

type MarkdownEditorProps = {
  /** Начальный текст. Дальше редактор — источник правды, перезаписывать нельзя. */
  initialValue: string;
  onChange: (value: string) => void;
};

/**
 * Обёртка над CodeMirror.
 *
 * Редактор создаётся один раз на монтирование и живёт своим состоянием: React
 * не пытается синхронизировать текст обратно. При переключении заметок родитель
 * задаёт `key={note.id}` — компонент пересоздаётся вместе с документом, и
 * позиция курсора от чужой заметки не переносится.
 */
export function MarkdownEditor({ initialValue, onChange }: MarkdownEditorProps) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const onChangeRef = React.useRef(onChange);

  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown({ base: markdownLanguage }),
          EditorView.lineWrapping,
          placeholder("Пишите. Markdown размечается на лету."),
          livePreview(),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });

    // Фокус при открытии не ставим: курсор на первой строке раскрывает на ней
    // сырую разметку, и заметка встречает пользователя видом «## Гипотеза».
    return () => view.destroy();
    // Пересоздание при смене текста не нужно: см. комментарий выше.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} className="h-full min-h-0 [&_.cm-editor]:h-full" />;
}
