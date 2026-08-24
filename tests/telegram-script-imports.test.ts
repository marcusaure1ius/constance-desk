import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Скрипт установки вебхука запускается вне приложения, и база ему не нужна.
 * Проверено вживую: стоит затянуть в него модуль, который импортирует
 * `@/lib/db`, и `npm run tg:webhook` падает с «No database connection string»
 * ещё до первой строки собственного кода — `lib/db/index.ts` вызывает `neon()`
 * прямо на импорте, а `loadEnvConfig` отрабатывает уже после импортов.
 */

const ROOT = resolve(__dirname, "..");

const read = (relativePath: string) => readFileSync(resolve(ROOT, relativePath), "utf8");

/** Локальные импорты модуля: и алиас @/..., и относительные пути. */
function localImports(source: string): string[] {
  return [...source.matchAll(/from\s+"((?:@\/|\.{1,2}\/)[^"]+)"/g)].map((m) => m[1]);
}

/** Путь к модулю относительно корня: `@/lib/db` → `lib/db/index.ts`. */
function resolveImport(specifier: string, fromFile: string): string {
  const base = specifier.startsWith("@/")
    ? resolve(ROOT, specifier.slice(2))
    : resolve(ROOT, fromFile, "..", specifier);
  const relative = base.slice(ROOT.length + 1);

  return existsSync(resolve(ROOT, `${relative}.ts`))
    ? `${relative}.ts`
    : `${relative}/index.ts`;
}

/** Все модули, до которых дотягивается файл по локальным импортам. */
function importClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    let source: string;
    try {
      source = read(file);
    } catch {
      continue; // не нашли файл — например, импорт из node_modules по алиасу
    }

    for (const specifier of localImports(source)) {
      queue.push(resolveImport(specifier, file));
    }
  }

  return seen;
}

describe("граф импортов скрипта вебхука", () => {
  it("не затягивает слой базы", () => {
    const closure = importClosure("scripts/telegram-webhook.ts");
    expect([...closure].filter((f) => f.startsWith("lib/db/"))).toEqual([]);
  });

  it("не затягивает обработчик апдейтов, который зависит от базы", () => {
    const closure = importClosure("scripts/telegram-webhook.ts");
    expect(closure.has("lib/telegram/handle-update.ts")).toBe(false);
  });

  it("список команд берётся из общего модуля, а не дублируется", () => {
    expect(read("scripts/telegram-webhook.ts")).toContain('from "../lib/telegram/commands"');
    expect(read("lib/telegram/handle-update.ts")).toContain('from "@/lib/telegram/commands"');
  });

  it("сам обход находит зависимость от базы там, где она есть", () => {
    // Страховка от тавтологии: обход обязан видеть lib/db через цепочку
    // handle-update → services/tg-updates → lib/db.
    const closure = importClosure("lib/telegram/handle-update.ts");
    expect(closure.has("lib/db/index.ts")).toBe(true);
  });
});
