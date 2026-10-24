/**
 * Разбор живых сообщений: что прислали в телеграм → что бот из этого сделал.
 *
 * Read-only. Берёт последние апдейты из tg_updates (с маршрутом Jev и
 * черновиком агента) и задачи, созданные в тот же промежуток, и печатает
 * рядом. Связи «апдейт → задача» в схеме пока нет (таблица tg_messages — это
 * S-14), поэтому сопоставление по времени.
 *
 * Запуск: npx tsx inspect-capture.ts [сколько_апдейтов]
 */
import { Client } from "pg";

/** Разбор, который обработчик кладёт в журнал (`lib/telegram/handle-update.ts`). */
type Parsed = {
  route?: {
    route: string;
    correction: boolean;
    source: string;
    confidence?: number;
    reason?: string;
    latencyMs?: number;
  };
  transcript?: string;
  /** Подписи вызовов черновика. */
  calls?: string[];
  agentText?: string;
  /** Поисковый запрос маршрута find_task. */
  query?: string;
};

type UpdateRow = {
  update_id: string;
  raw_text: string | null;
  status: string;
  error: string | null;
  created_at: Date;
  processed_at: Date | null;
  payload: Record<string, unknown>;
  parsed: Parsed | null;
};

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  planned_date: string | null;
  created_at: Date;
  column_title: string;
  environment_name: string;
  category_name: string | null;
};

const LIMIT = Number(process.argv[2] ?? 15);

const time = (d: Date | null) =>
  d ? d.toISOString().replace("T", " ").slice(0, 19) : "—";

/** Голосовое, фото, документ — то, что пришло не текстом. */
function kindOf(payload: Record<string, unknown>): string {
  const msg = (payload.message ?? payload.edited_message ?? {}) as Record<string, unknown>;
  if (payload.callback_query) return "кнопка";
  if (msg.voice) return "голос";
  if (msg.photo) return "фото";
  if (msg.document) return "документ";
  if (msg.forward_origin) return "пересылка";
  return "текст";
}

/** Что бот понял из сообщения — то, ради чего разбор и сохраняется. */
function printParsed(parsed: Parsed | null): void {
  if (!parsed?.route) {
    console.log("  разбор: не сохранён");
    return;
  }

  const { route } = parsed;
  const bits = [
    route.source,
    route.confidence !== undefined ? `уверенность ${route.confidence.toFixed(2)}` : null,
    route.latencyMs !== undefined ? `${route.latencyMs} мс` : null,
    route.reason ? `причина: ${route.reason}` : null,
    route.correction ? "поправка" : null,
  ].filter(Boolean);
  console.log(`  маршрут: ${route.route} [${bits.join(" · ")}]`);

  if (parsed.transcript) {
    console.log(`    расшифровка: ${JSON.stringify(parsed.transcript.slice(0, 120))}`);
  }
  if (parsed.query) console.log(`    поиск: ${JSON.stringify(parsed.query)}`);

  for (const label of parsed.calls ?? []) {
    console.log(`    черновик: ${label}`);
  }
  if (parsed.calls && parsed.calls.length === 0) console.log("    черновик: пусто");
  if (parsed.agentText) {
    console.log(`    агент: ${JSON.stringify(parsed.agentText.slice(0, 200))}`);
  }
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const updates = await client.query<UpdateRow>(
      `SELECT update_id::text, raw_text, status, error, created_at, processed_at, payload, parsed
       FROM tg_updates ORDER BY created_at DESC LIMIT $1`,
      [LIMIT]
    );

    if (updates.rows.length === 0) {
      console.log("В журнале пусто — бот не получил ни одного апдейта.");
      return;
    }

    const since = updates.rows[updates.rows.length - 1].created_at;

    const tasks = await client.query<TaskRow>(
      `SELECT t.id::text, t.title, t.description, t.priority, t.planned_date::text,
              t.created_at, c.title AS column_title, e.name AS environment_name,
              cat.name AS category_name
       FROM tasks t
       JOIN columns c ON c.id = t.column_id
       JOIN environments e ON e.id = c.environment_id
       LEFT JOIN categories cat ON cat.id = t.category_id
       WHERE t.created_at >= $1
       ORDER BY t.created_at ASC`,
      [since]
    );

    console.log(`\n${"=".repeat(78)}`);
    console.log(`ЖУРНАЛ: ${updates.rows.length} апдейтов (свежие сверху)`);
    console.log("=".repeat(78));

    for (const u of [...updates.rows].reverse()) {
      const mark = u.status === "processed" ? "✓" : u.status === "failed" ? "✗" : "…";
      console.log(`\n${mark} ${time(u.created_at)}  #${u.update_id}  [${kindOf(u.payload)}]  ${u.status}`);
      if (u.raw_text) {
        console.log(`  прислано: ${JSON.stringify(u.raw_text)}`);
      } else {
        console.log("  прислано: (без текста)");
      }
      if (u.error) console.log(`  ОШИБКА: ${u.error}`);
      printParsed(u.parsed);
    }

    console.log(`\n${"=".repeat(78)}`);
    console.log(`СОЗДАННЫЕ ЗАДАЧИ за тот же период: ${tasks.rows.length}`);
    console.log("=".repeat(78));

    for (const t of tasks.rows) {
      const bits = [
        t.planned_date ? `срок ${t.planned_date}` : null,
        t.priority !== "normal" ? `приоритет ${t.priority}` : null,
        t.category_name ? `эпик «${t.category_name}»` : null,
      ].filter(Boolean);
      console.log(`\n  ${time(t.created_at)}  «${t.title}»`);
      console.log(`     ${t.environment_name} · ${t.column_title}${bits.length ? " · " + bits.join(" · ") : ""}`);
      if (t.description) console.log(`     описание: ${JSON.stringify(t.description.slice(0, 160))}`);
    }

    console.log("");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("Ошибка:", e instanceof Error ? e.message : e);
  process.exit(1);
});
