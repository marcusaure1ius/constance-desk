import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

/*
 * Заметки на настоящей PostgreSQL.
 *
 * На моках drizzle это не проверить: каскадное удаление, уникальность имени
 * среди соседей и составной внешний ключ «папка вместе со средой» выполняет
 * база, а не наш код. Ровно эти правила и держат путь однозначным.
 *
 * В основной прогон (npm test) не попадают: файлы *.integration.test.ts
 * исключены маской в vitest.config.ts.
 *
 * Запуск: TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55455/constance_ci \
 *   npm run test:integration:db
 * Схему в базу накатывает npm run db:migrate (в CI — джоба migrations).
 */

// Пропуска (describe.skipIf) здесь намеренно нет: без базы прогон был бы
// зелёным, не проверив ничего.
vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("./helpers/test-db");
  return { db: createTestDb() };
});

import {
  NotesError,
  appendToNote,
  createFolder,
  createNote,
  createNoteByPath,
  deleteFolder,
  findNoteByPath,
  getNote,
  listFoldersWithPaths,
  listNotesWithPaths,
  moveFolder,
  moveNote,
  renameFolder,
  requireNoteByPath,
  updateNote,
} from "@/lib/services/notes";
import { searchNotes } from "@/lib/services/search";
import { environments, notes } from "@/lib/db/schema";
import { closeTestDb, createTestDb } from "./helpers/test-db";

const ids: Record<string, string> = {};

describe("заметки на настоящей базе", () => {
  beforeAll(async () => {
    const db = createTestDb();

    const [envA] = await db
      .insert(environments)
      .values({ name: "Заметки среда А", color: "#3b82f6", position: 910 })
      .returning();
    const [envB] = await db
      .insert(environments)
      .values({ name: "Заметки среда Б", color: "#22c55e", position: 911 })
      .returning();

    ids.envA = envA.id;
    ids.envB = envB.id;
  });

  afterAll(async () => {
    const db = createTestDb();
    // Среды уходят каскадом вместе с папками и заметками.
    await db.delete(environments).where(inArray(environments.id, [ids.envA, ids.envB]));
    await closeTestDb();
  });

  it("создаёт заметку по пути, заводя недостающие папки", async () => {
    const note = await createNoteByPath(ids.envA, "Цены/Аномалии/Выбросы.md", "## Гипотеза");

    expect(note.title).toBe("Выбросы");
    expect(note.text).toBe("## Гипотеза");

    const folders = await listFoldersWithPaths(ids.envA);
    expect(folders.map((folder) => folder.path)).toEqual(
      expect.arrayContaining(["Цены", "Цены/Аномалии"])
    );
  });

  it("находит заметку по тому же пути, каким её создали", async () => {
    const found = await findNoteByPath(ids.envA, "Цены/Аномалии/Выбросы");
    expect(found?.text).toBe("## Гипотеза");
  });

  it("несуществующий путь — внятная ошибка, а не пустота", async () => {
    await expect(requireNoteByPath(ids.envA, "Цены/Нет такой")).rejects.toThrow(NotesError);
    expect(await findNoteByPath(ids.envA, "Выдуманная/Папка/Файл")).toBeUndefined();
  });

  // Иначе путь «Цены/Аномалии» адресовал бы две разные папки.
  it("тёзка среди соседей отвергается", async () => {
    await expect(createFolder({ environmentId: ids.envA, name: "Цены" })).rejects.toThrow(
      NotesError
    );
    await expect(
      createNoteByPath(ids.envA, "Цены/Аномалии/Выбросы", "другой текст")
    ).rejects.toThrow(NotesError);
  });

  // Тёзки в разных ветках — обычное дело и запрещать их нечего.
  it("одноимённые папки в разных ветках уживаются", async () => {
    const note = await createNoteByPath(ids.envA, "Встречи/Аномалии/Заметка", "");
    expect(note.id).toBeTruthy();

    const paths = (await listFoldersWithPaths(ids.envA)).map((folder) => folder.path);
    expect(paths).toEqual(expect.arrayContaining(["Цены/Аномалии", "Встречи/Аномалии"]));
  });

  it("дописывание не трогает уже написанное", async () => {
    const note = await requireNoteByPath(ids.envA, "Цены/Аномалии/Выбросы");
    const updated = await appendToNote(note.id, "Ещё мысль");

    expect(updated.text).toBe("## Гипотеза\n\nЕщё мысль");
  });

  it("перезапись заменяет текст целиком", async () => {
    const note = await requireNoteByPath(ids.envA, "Цены/Аномалии/Выбросы");
    const updated = await updateNote(note.id, { text: "только это" });

    expect(updated.text).toBe("только это");
  });

  it("переименование папки меняет путь всех заметок под ней", async () => {
    const folders = await listFoldersWithPaths(ids.envA);
    const prices = folders.find((folder) => folder.path === "Цены")!;

    await renameFolder(prices.id, "Ценообразование");

    expect(await findNoteByPath(ids.envA, "Цены/Аномалии/Выбросы")).toBeUndefined();
    expect(await findNoteByPath(ids.envA, "Ценообразование/Аномалии/Выбросы")).toBeTruthy();

    await renameFolder(prices.id, "Цены");
  });

  it("папка не вкладывается в собственную подпапку", async () => {
    const folders = await listFoldersWithPaths(ids.envA);
    const prices = folders.find((folder) => folder.path === "Цены")!;
    const anomalies = folders.find((folder) => folder.path === "Цены/Аномалии")!;

    await expect(moveFolder(prices.id, anomalies.id)).rejects.toThrow(NotesError);
    await expect(moveFolder(prices.id, prices.id)).rejects.toThrow(NotesError);
  });

  // Составной внешний ключ стережёт это на уровне базы, но сообщение об ошибке
  // должно быть человеческим, а не текстом от драйвера.
  it("заметку нельзя положить в папку чужого проекта", async () => {
    const foreign = await createFolder({ environmentId: ids.envB, name: "Чужая" });
    const note = await requireNoteByPath(ids.envA, "Цены/Аномалии/Выбросы");

    await expect(moveNote(note.id, foreign.id)).rejects.toThrow(NotesError);
    await expect(
      createNote({ environmentId: ids.envA, title: "Подкидыш", folderId: foreign.id })
    ).rejects.toThrow(NotesError);
  });

  it("поддерево list_notes включает вложенные папки", async () => {
    const all = await listNotesWithPaths(ids.envA);
    const subtree = await listNotesWithPaths(ids.envA, "Цены");

    expect(all.length).toBeGreaterThan(subtree.length);
    expect(subtree.map((note) => note.path)).toEqual(["Цены/Аномалии/Выбросы"]);
  });

  it("поиск отдаёт заметку с полным путём", async () => {
    const found = await searchNotes("только это");
    const hit = found.find((item) => item.path.endsWith("Выбросы"));

    expect(hit?.path).toBe("Цены/Аномалии/Выбросы");
    expect(hit?.environment.id).toBe(ids.envA);
  });

  it("поиск идёт и по заголовку, и по тексту", async () => {
    await createNoteByPath(ids.envB, "Слово в заголовке", "");
    await createNoteByPath(ids.envB, "Другая", "слово в тексте");

    const found = await searchNotes("слово");
    const paths = found.map((hit) => hit.path);

    expect(paths).toEqual(expect.arrayContaining(["Слово в заголовке", "Другая"]));
  });

  it("удаление папки уносит вложенное каскадом, не задевая соседей", async () => {
    const prices = (await listFoldersWithPaths(ids.envA)).find(
      (folder) => folder.path === "Цены"
    )!;
    const note = await requireNoteByPath(ids.envA, "Цены/Аномалии/Выбросы");

    await deleteFolder(prices.id);

    expect(await getNote(note.id)).toBeUndefined();

    // Проверка по путям, а не по именам: «Аномалии» есть и в ветке «Встречи»,
    // и она обязана уцелеть — иначе каскад забрал бы лишнее.
    const left = (await listFoldersWithPaths(ids.envA)).map((folder) => folder.path);
    expect(left.some((path) => path.startsWith("Цены"))).toBe(false);
    expect(left).toContain("Встречи/Аномалии");
  });

  it("удаление среды уносит её заметки", async () => {
    const db = createTestDb();
    const [temp] = await db
      .insert(environments)
      .values({ name: "Заметки среда В", color: "#ef4444", position: 912 })
      .returning();

    const note = await createNoteByPath(temp.id, "Папка/Заметка", "текст");
    await db.delete(environments).where(eq(environments.id, temp.id));

    const left = await db.select().from(notes).where(eq(notes.id, note.id));
    expect(left).toHaveLength(0);
  });
});
