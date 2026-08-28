import { describe, it, expect } from "vitest";
import {
  NotePathError,
  assertValidSegment,
  formatNotePath,
  parseFolderPath,
  parseNotePath,
} from "@/lib/notes/path";
import { buildNoteTree, folderChainToNote } from "@/lib/notes/tree";
import { toolsFor } from "@/lib/agent/tools";

/*
 * Офлайн-часть заметок: разбор путей, сборка дерева и состав реестра
 * инструментов. Всё это чистые функции — база здесь не нужна, а поведение
 * сервисов проверяется в notes.integration.test.ts.
 */

describe("разбор пути заметки", () => {
  it("последний сегмент — заголовок, остальное — папки", () => {
    expect(parseNotePath("Работа/Цены/Аномалии")).toEqual({
      folders: ["Работа", "Цены"],
      title: "Аномалии",
    });
  });

  it("заметка без папок лежит в корне", () => {
    expect(parseNotePath("Входящее")).toEqual({ folders: [], title: "Входящее" });
  });

  // Модель пишет путь то с расширением, то без — принимаем оба вида, но
  // хранится всегда заголовок без «.md».
  it("расширение .md необязательно и в заголовок не попадает", () => {
    expect(parseNotePath("Цены/Аномалии.md").title).toBe("Аномалии");
    expect(parseNotePath("Цены/Аномалии.MD").title).toBe("Аномалии");
  });

  it("лишние слэши и пробелы не меняют смысла пути", () => {
    expect(parseNotePath("/Работа//Цены/ Аномалии ")).toEqual({
      folders: ["Работа", "Цены"],
      title: "Аномалии",
    });
  });

  // Тихо истолковать «..» по-своему опаснее, чем отказаться: путь означал бы
  // не то, что записано.
  it("относительные сегменты отвергаются", () => {
    expect(() => parseNotePath("Работа/../Личное/Заметка")).toThrow(NotePathError);
    expect(() => parseFolderPath("./Работа")).toThrow(NotePathError);
  });

  it("пустой путь — ошибка, а не заметка без имени", () => {
    expect(() => parseNotePath("   ")).toThrow(NotePathError);
    expect(() => parseNotePath("///")).toThrow(NotePathError);
  });

  it("корневой путь папки — пустой список сегментов", () => {
    expect(parseFolderPath("")).toEqual([]);
    expect(parseFolderPath("/")).toEqual([]);
  });
});

describe("проверка имени", () => {
  it("обрезает пробелы по краям", () => {
    expect(assertValidSegment("  Цены  ", "папки")).toBe("Цены");
  });

  // Слэш в имени сделал бы заметку неадресуемой: «Цены/КУ» в корне и «КУ»
  // в папке «Цены» дали бы одну и ту же строку пути.
  it("слэш в имени запрещён", () => {
    expect(() => assertValidSegment("Цены/КУ", "папки")).toThrow(NotePathError);
  });

  it("пустое имя запрещено", () => {
    expect(() => assertValidSegment("   ", "заметки")).toThrow(NotePathError);
  });

  it("собранный путь разбирается обратно", () => {
    const path = formatNotePath(["Работа", "Цены"], "Аномалии");
    expect(path).toBe("Работа/Цены/Аномалии");
    expect(parseNotePath(path)).toEqual({
      folders: ["Работа", "Цены"],
      title: "Аномалии",
    });
  });
});

describe("сборка дерева", () => {
  const folders = [
    { id: "f-prices", name: "Цены", parentId: null },
    { id: "f-anomalies", name: "Аномалии", parentId: "f-prices" },
    { id: "f-meetings", name: "Встречи", parentId: null },
  ];
  const notes = [
    { id: "n-root", title: "Входящее", folderId: null },
    { id: "n-deep", title: "Выбросы", folderId: "f-anomalies" },
  ];

  it("вкладывает папки и заметки по родителю", () => {
    const tree = buildNoteTree(folders, notes);
    const prices = tree.find((node) => node.kind === "folder" && node.id === "f-prices");

    expect(prices).toMatchObject({ kind: "folder", name: "Цены" });
    const anomalies = prices!.kind === "folder" ? prices!.children[0] : null;
    expect(anomalies).toMatchObject({ kind: "folder", name: "Аномалии" });
  });

  it("папки идут выше заметок, внутри группы — по алфавиту", () => {
    const tree = buildNoteTree(folders, notes);
    expect(tree.map((node) => (node.kind === "folder" ? node.name : node.title))).toEqual([
      "Встречи",
      "Цены",
      "Входящее",
    ]);
  });

  // Осиротевшая строка должна остаться видимой: потерять заметку молча хуже,
  // чем показать её не в той папке.
  it("потерянного родителя вешает в корень, а не теряет узел", () => {
    const tree = buildNoteTree(folders, [
      { id: "n-orphan", title: "Ничейная", folderId: "f-которой-нет" },
    ]);
    expect(tree.some((node) => node.kind === "note" && node.title === "Ничейная")).toBe(true);
  });

  it("цепочка папок до заметки — от неё к корню", () => {
    expect(folderChainToNote(folders, "f-anomalies")).toEqual(["f-anomalies", "f-prices"]);
    expect(folderChainToNote(folders, null)).toEqual([]);
  });

  // Кольцо в данных не должно вешать интерфейс.
  it("кольцо в родителях не зацикливает подъём", () => {
    const looped = [
      { id: "a", name: "A", parentId: "b" },
      { id: "b", name: "B", parentId: "a" },
    ];
    expect(folderChainToNote(looped, "a")).toEqual(["a", "b"]);
  });
});

describe("реестр инструментов заметок", () => {
  const names = (surface: "mcp" | "chat", includeMutations = true) =>
    toolsFor({ surface, includeMutations }).map((tool) => tool.name);

  it("заметки доступны и в MCP, и в чате агента", () => {
    for (const surface of ["mcp", "chat"] as const) {
      expect(names(surface)).toEqual(
        expect.arrayContaining([
          "list_note_folders",
          "list_notes",
          "read_note",
          "search_notes",
          "create_note",
          "append_note",
          "update_note",
          "delete_note",
        ])
      );
    }
  });

  // Фаза анализа агентского пути получает только читающие инструменты — это
  // свойство кода, а не текста промпта.
  it("в фазе анализа пишущих инструментов заметок нет", () => {
    const readOnly = names("chat", false);
    expect(readOnly).toContain("read_note");
    expect(readOnly).toContain("search_notes");
    expect(readOnly).not.toContain("create_note");
    expect(readOnly).not.toContain("append_note");
    expect(readOnly).not.toContain("update_note");
    expect(readOnly).not.toContain("delete_note");
  });

  /*
   * Дописывание видно на доске и снимается руками, перезапись и удаление —
   * нет. От этого зависит, спросит ли агент кнопкой или сделает сразу.
   */
  it("необратимость размечена по последствиям, а не по слову «мутация»", () => {
    const byName = new Map(toolsFor({ surface: "chat" }).map((tool) => [tool.name, tool]));

    expect(byName.get("append_note")!.impact).toBe("reversible");
    expect(byName.get("update_note")!.impact).toBe("irreversible");
    expect(byName.get("delete_note")!.impact).toBe("irreversible");
    expect(byName.get("create_note")!.impact).toBe("irreversible");
  });
});
