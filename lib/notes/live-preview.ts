/**
 * Живое превью markdown — то, чем Obsidian отличается от «поля с текстом».
 *
 * Разметка размечена всегда, а служебные символы (`##`, `**`, «`») скрыты
 * везде, кроме строки, на которой стоит курсор. Правишь — видишь исходник,
 * ушёл со строки — видишь результат, и всё это в одном поле, без переключения
 * режимов.
 *
 * Решение «раскрывать по строке, а не по узлу» осознанное: раскрытие по узлу
 * заставляет символы прыгать внутри строки при каждом сдвиге курсора, и текст
 * дёргается под руками.
 */

import { syntaxTree } from "@codemirror/language";
import { type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

/** Заголовки: узел синтаксиса → класс строки. */
const HEADING_CLASSES: Record<string, string> = {
  ATXHeading1: "cm-md-h1",
  ATXHeading2: "cm-md-h2",
  ATXHeading3: "cm-md-h3",
  ATXHeading4: "cm-md-h4",
  ATXHeading5: "cm-md-h5",
  ATXHeading6: "cm-md-h6",
};

/** Инлайн-узлы: узел → класс оформления содержимого. */
const INLINE_CLASSES: Record<string, string> = {
  StrongEmphasis: "cm-md-strong",
  Emphasis: "cm-md-em",
  InlineCode: "cm-md-code",
  Strikethrough: "cm-md-strike",
};

/**
 * Служебные символы, которые прячутся вне активной строки. `URL` в списке
 * потому, что в живом превью ссылка выглядит как текст, а не как `[текст](url)`.
 */
const MARK_NODES = new Set([
  "HeaderMark",
  "EmphasisMark",
  "CodeMark",
  "StrikethroughMark",
  "QuoteMark",
  "LinkMark",
  "URL",
  // Язык блока кода. Прячется вместе с ограждением: скрыть ``` и оставить
  // «sql» отдельной строкой — хуже, чем не прятать ничего.
  "CodeInfo",
]);

const hidden = Decoration.replace({});

class BulletWidget extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-bullet";
    span.textContent = "•";
    return span;
  }
  eq() {
    return true;
  }
  ignoreEvent() {
    return false;
  }
}

const bullet = Decoration.replace({ widget: new BulletWidget() });

/** Ищет `[ ]` или `[x]` в строке списка задач. Группа 2 — сам символ. */
const TASK_MARKER_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

/**
 * Чекбокс списка задач.
 *
 * Рисуется настоящей рамкой со скруглением и галочкой, а не символами ☐/☑:
 * шрифтовые квадратики приходят из случайного шрифта, у них свой кегль и своя
 * базовая линия, и в строке они выглядят инородно.
 *
 * Виджет кликабельный — нажатие переписывает `[ ]` в `[x]` и обратно. Позиция
 * берётся из DOM в момент клика, а не запоминается при создании: документ
 * между этими моментами мог измениться.
 */
class TaskWidget extends WidgetType {
  constructor(private readonly checked: boolean) {
    super();
  }

  toDOM(view: EditorView) {
    const box = document.createElement("span");
    box.className = this.checked ? "cm-md-check cm-md-check-on" : "cm-md-check";
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(this.checked));

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 12 12");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M2.6 6.3 L4.9 8.6 L9.4 3.7");
    svg.appendChild(path);
    box.appendChild(svg);

    box.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const line = view.state.doc.lineAt(view.posAtDOM(box));
      const match = TASK_MARKER_RE.exec(line.text);
      if (!match) return;
      const from = line.from + match[1].length;
      view.dispatch({
        changes: { from, to: from + 1, insert: this.checked ? " " : "x" },
      });
    });

    return box;
  }

  eq(other: TaskWidget) {
    return other.checked === this.checked;
  }

  /**
   * Все события внутри виджета редактору не отдаются: иначе нажатие на чекбокс
   * одновременно ставило бы курсор и переключало галочку.
   */
  ignoreEvent() {
    return true;
  }
}

/**
 * Номера строк, где стоит курсор или лежит выделение. На них разметка сырая.
 *
 * Без фокуса активных строк нет вовсе: курсор по умолчанию стоит в нулевой
 * позиции, и заметка, которую только открыли, встречала бы читателя строкой
 * «## Гипотеза» — при том что никто в неё ещё не поставил курсор.
 */
function activeLines(view: EditorView): Set<number> {
  const lines = new Set<number>();
  if (!view.hasFocus) return lines;

  for (const range of view.state.selection.ranges) {
    const first = view.state.doc.lineAt(range.from).number;
    const last = view.state.doc.lineAt(range.to).number;
    for (let line = first; line <= last; line++) lines.add(line);
  }
  return lines;
}

function buildDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const active = activeLines(view);
  const doc = view.state.doc;

  const isActive = (pos: number) => active.has(doc.lineAt(pos).number);

  /**
   * Строчная декорация на каждую строку блока: цитаты и код многострочны.
   *
   * Первая и последняя строки дополнительно помечаются `-start` и `-end`.
   * Плашка кода — это набор отдельных строк, и скруглить её сверху и снизу
   * можно только зная, где она начинается и где кончается.
   */
  const lineClass = (from: number, to: number, className: string) => {
    const first = doc.lineAt(from).number;
    const last = doc.lineAt(to).number;
    for (let number = first; number <= last; number++) {
      const line = doc.line(number);
      const edges = [
        number === first ? `${className}-start` : "",
        number === last ? `${className}-end` : "",
      ].filter(Boolean);
      decorations.push(
        Decoration.line({ class: [className, ...edges].join(" ") }).range(line.from)
      );
    }
  };

  /**
   * Блок кода: тело оформляется плашкой, строки ограждения схлопываются в ноль.
   *
   * Просто спрятать ``` мало — пустая строка остаётся и занимает высоту, из-за
   * чего у плашки появляются пустые полосы сверху и снизу. Схлопнутая строка
   * при этом остаётся строкой: поставив в неё курсор, ограждение видно снова.
   */
  const fencedBlock = (from: number, to: number) => {
    const first = doc.lineAt(from).number;
    const last = doc.lineAt(to).number;
    const isFence = (number: number) => /^\s*(```|~~~)/.test(doc.line(number).text);
    const collapsible = (number: number) =>
      isFence(number) && !active.has(number);

    let bodyFirst = first;
    let bodyLast = last;
    if (collapsible(first)) bodyFirst = first + 1;
    if (last > first && collapsible(last)) bodyLast = last - 1;

    // Блок из одних ограждений (пустой или недописанный) не схлопываем: иначе
    // он исчезнет с экрана целиком.
    if (bodyFirst > bodyLast) {
      bodyFirst = first;
      bodyLast = last;
    }

    for (let number = first; number <= last; number++) {
      const classes = ["cm-md-fenced"];
      if (number < bodyFirst || number > bodyLast) {
        classes.push("cm-md-fence-collapsed");
      } else {
        if (number === bodyFirst) classes.push("cm-md-fenced-start");
        if (number === bodyLast) classes.push("cm-md-fenced-end");
      }
      decorations.push(
        Decoration.line({ class: classes.join(" ") }).range(doc.line(number).from)
      );
    }
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        const heading = HEADING_CLASSES[node.name];
        if (heading) {
          lineClass(node.from, node.from, heading);
          return;
        }

        const inline = INLINE_CLASSES[node.name];
        if (inline && node.to > node.from) {
          decorations.push(
            Decoration.mark({ class: inline }).range(node.from, node.to)
          );
          return;
        }

        switch (node.name) {
          case "Blockquote":
            lineClass(node.from, node.to, "cm-md-quote");
            return;
          case "FencedCode": {
            fencedBlock(node.from, node.to);
            return;
          }
          case "HorizontalRule":
            lineClass(node.from, node.from, "cm-md-rule");
            // Сами дефисы прячутся: черта уже нарисована рамкой строки.
            if (!isActive(node.from) && node.to > node.from) {
              decorations.push(hidden.range(node.from, node.to));
            }
            return;
          case "Link":
            decorations.push(
              Decoration.mark({ class: "cm-md-link" }).range(node.from, node.to)
            );
            return;
          case "ListItem":
            lineClass(node.from, node.to, "cm-md-list");
            return;
          case "TaskMarker": {
            const done = /x/i.test(doc.sliceString(node.from, node.to));
            // Маркер списка скрыт, поэтому висячий отступ пункту не нужен —
            // иначе чекбокс уезжает в поле, на место исчезнувшей точки.
            lineClass(node.from, node.from, "cm-md-taskline");
            if (done) lineClass(node.from, node.from, "cm-md-done");
            if (isActive(node.from)) return;
            decorations.push(
              Decoration.replace({ widget: new TaskWidget(done) }).range(node.from, node.to)
            );
            return;
          }
          case "ListMark": {
            if (isActive(node.from)) return;
            // У задачи маркером служит сам чекбокс: точка перед ним лишняя, а
            // зачёркивание выполненного пункта проходило бы прямо по ней.
            if (TASK_MARKER_RE.test(doc.lineAt(node.from).text)) {
              const gap = doc.sliceString(node.to, node.to + 1) === " " ? 1 : 0;
              decorations.push(hidden.range(node.from, node.to + gap));
              return;
            }
            const text = doc.sliceString(node.from, node.to);
            // Нумерованный список заменять нечем: «1.» — это и есть содержимое.
            // Но покрасить как маркер стоит, иначе номер спорит с текстом.
            if (!/^[-*+]$/.test(text)) {
              decorations.push(
                Decoration.mark({ class: "cm-md-ordered" }).range(node.from, node.to)
              );
              return;
            }
            decorations.push(bullet.range(node.from, node.to));
            return;
          }
        }

        if (!MARK_NODES.has(node.name)) return;
        if (isActive(node.from)) return;
        if (node.to <= node.from) return;

        // `## ` прячется вместе с пробелом: иначе заголовок съезжает вправо на
        // один символ и колонка текста ломается ровно там, где её видно.
        const trailing =
          node.name === "HeaderMark" || node.name === "QuoteMark"
            ? doc.sliceString(node.to, node.to + 1) === " "
              ? 1
              : 0
            : 0;

        decorations.push(hidden.range(node.from, node.to + trailing));
      },
    });
  }

  return Decoration.set(decorations, true);
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      // Пересчёт и на движении курсора, и на потере фокуса: от них зависит,
      // что скрыто.
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.focusChanged
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations }
);

/**
 * Оформление. Цвета берутся из переменных темы проекта, а не из готовой темы
 * CodeMirror — иначе редактор жил бы в своей палитре и не переключался вместе
 * с остальным приложением.
 */
/**
 * Оформление.
 *
 * Ориентир — типографика справки Obsidian: узкая колонка, крупный кегль,
 * воздух между блоками, код и цитаты плашками. Ширина ограничена не ради
 * красоты: строка во всю ширину панели — это 150+ символов, глаз на такой
 * длине теряет начало следующей строки.
 *
 * Цвета берутся из переменных темы проекта, а не из готовой темы CodeMirror —
 * иначе редактор жил бы в своей палитре и не переключался вместе с
 * приложением.
 */
const livePreviewTheme = EditorView.theme({
  "&": { color: "var(--foreground)", backgroundColor: "transparent", height: "100%" },
  ".cm-scroller": {
    fontFamily: "var(--font-sans)",
    fontSize: "16px",
    lineHeight: "1.65",
    overflow: "auto",
  },
  // Колонка текста, а не полоса во весь экран. Нижний отступ — чтобы последняя
  // строка не липла к краю окна при наборе.
  ".cm-content": {
    width: "100%",
    maxWidth: "44rem",
    margin: "0 auto",
    padding: "16px 0 40vh",
    caretColor: "var(--foreground)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-line": { padding: "0 2px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "color-mix(in oklch, var(--primary) 22%, transparent)" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-placeholder": { color: "var(--muted-foreground)" },

  // Заголовки. Воздух сверху больше, чем снизу: заголовок принадлежит тому,
  // что под ним, и должен отрываться от предыдущего абзаца.
  ".cm-md-h1": {
    fontSize: "1.9em",
    fontWeight: "700",
    lineHeight: "1.25",
    letterSpacing: "-0.02em",
    padding: "0.7em 2px 0.1em",
  },
  ".cm-md-h2": {
    fontSize: "1.5em",
    fontWeight: "650",
    lineHeight: "1.3",
    letterSpacing: "-0.015em",
    padding: "0.65em 2px 0.1em",
  },
  ".cm-md-h3": { fontSize: "1.25em", fontWeight: "650", padding: "0.6em 2px 0.05em" },
  ".cm-md-h4": { fontSize: "1.1em", fontWeight: "650", padding: "0.5em 2px 0.05em" },
  ".cm-md-h5": { fontSize: "1em", fontWeight: "650", padding: "0.45em 2px 0.05em" },
  ".cm-md-h6": {
    fontSize: "0.95em",
    fontWeight: "650",
    color: "var(--muted-foreground)",
    padding: "0.45em 2px 0.05em",
  },

  ".cm-md-strong": { fontWeight: "700" },
  ".cm-md-em": { fontStyle: "italic" },
  ".cm-md-strike": { textDecoration: "line-through", color: "var(--muted-foreground)" },

  ".cm-md-code": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.85em",
    color: "var(--primary)",
    backgroundColor: "color-mix(in oklch, var(--muted) 70%, var(--background))",
    border: "1px solid var(--border)",
    borderRadius: "5px",
    padding: "0.12em 0.35em",
  },

  ".cm-md-link": {
    color: "var(--primary)",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
    textDecorationThickness: "1px",
  },

  // Цитата — плашка с полосой слева, а не просто серый текст.
  ".cm-md-quote": {
    borderLeft: "3px solid color-mix(in oklch, var(--primary) 45%, var(--border))",
    backgroundColor: "color-mix(in oklch, var(--muted) 55%, transparent)",
    padding: "0.1em 12px",
    color: "var(--muted-foreground)",
  },
  ".cm-md-quote-start": { paddingTop: "0.45em", borderTopRightRadius: "8px" },
  ".cm-md-quote-end": { paddingBottom: "0.45em", borderBottomRightRadius: "8px" },

  // Блок кода. Плашка собирается из отдельных строк, поэтому боковые рамки и
  // скругления расставляются по краям вручную.
  ".cm-md-fenced": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.85em",
    lineHeight: "1.55",
    backgroundColor: "color-mix(in oklch, var(--muted) 70%, var(--background))",
    borderLeft: "1px solid var(--border)",
    borderRight: "1px solid var(--border)",
    padding: "0 12px",
  },
  ".cm-md-fenced-start": {
    paddingTop: "0.6em",
    borderTop: "1px solid var(--border)",
    borderTopLeftRadius: "8px",
    borderTopRightRadius: "8px",
    marginTop: "0.5em",
  },
  ".cm-md-fence-collapsed": {
    height: "0",
    padding: "0 12px",
    overflow: "hidden",
  },
  ".cm-md-fenced-end": {
    paddingBottom: "0.6em",
    borderBottom: "1px solid var(--border)",
    borderBottomLeftRadius: "8px",
    borderBottomRightRadius: "8px",
    marginBottom: "0.5em",
  },

  // Дефисы `---` скрыты, чертой служит сама рамка строки.
  ".cm-md-rule": {
    borderBottom: "1px solid var(--border)",
    height: "0.85em",
    margin: "0.8em 0",
  },

  // Висячий отступ: перенос длинного пункта встаёт под текст, а не под маркер.
  ".cm-md-list": { paddingLeft: "1.5em", textIndent: "-1.5em" },
  ".cm-md-bullet": {
    color: "color-mix(in oklch, var(--primary) 70%, var(--muted-foreground))",
    paddingRight: "0.45em",
  },
  ".cm-md-taskline": { textIndent: "0" },
  ".cm-md-ordered": { color: "color-mix(in oklch, var(--primary) 70%, var(--muted-foreground))" },

  ".cm-md-check": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "1.05em",
    height: "1.05em",
    marginRight: "0.15em",
    verticalAlign: "-0.18em",
    border: "1.5px solid color-mix(in oklch, var(--muted-foreground) 55%, transparent)",
    borderRadius: "4px",
    backgroundColor: "var(--background)",
    cursor: "pointer",
    // Текст пункта зачёркнут целиком строчной декорацией — сам чекбокс из-под
    // неё надо вывести, иначе через него проходит линия.
    textDecoration: "none",
  },
  ".cm-md-check:hover": { borderColor: "var(--primary)" },
  ".cm-md-check-on": { backgroundColor: "var(--primary)", borderColor: "var(--primary)" },
  ".cm-md-check svg": {
    width: "0.8em",
    height: "0.8em",
    fill: "none",
    stroke: "var(--primary-foreground)",
    strokeWidth: "2.1",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    opacity: "0",
  },
  ".cm-md-check-on svg": { opacity: "1" },

  ".cm-md-done": { color: "var(--muted-foreground)", textDecoration: "line-through" },
});

export function livePreview(): Extension {
  return [livePreviewPlugin, livePreviewTheme];
}
