import { format } from "date-fns";
import { ru } from "date-fns/locale";
import type { ExtendedWeeklyReport, WeekTrendItem } from "@/lib/services/reports";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_CHAT_MODEL = "openai/gpt-oss-20b";

export type AiAnalysis = {
  summary: string;
  completionRate: string;
  weekComparison: string;
  trends: string;
  risks: string[];
  nextWeekFocus: string[];
};

function formatTaskForPrompt(task: {
  title: string;
  categoryName: string | null;
  completedAt: Date | null;
  startDate: string;
}): string {
  const status = task.completedAt ? "Готово" : "В работе";
  const category = task.categoryName ? ` [${task.categoryName}]` : "";
  return `- ${task.title}${category} (начата: ${task.startDate}, статус: ${status})`;
}

function formatTrendForPrompt(trend: WeekTrendItem[]): string {
  return trend
    .map((item) => {
      const weekLabel = format(new Date(item.weekStart), "d MMM yyyy", { locale: ru });
      return `Неделя ${weekLabel}: завершено ${item.completed}, в работе ${item.inProgress}, новых ${item.new}`;
    })
    .join("\n");
}

export function buildAiPrompt(
  report: ExtendedWeeklyReport,
  trend: WeekTrendItem[],
): string {
  const weekStart = format(new Date(report.weekStart), "d MMMM yyyy", { locale: ru });
  const weekEnd = format(new Date(report.weekEnd), "d MMMM yyyy", { locale: ru });

  const completedSection =
    report.completedTasks.length > 0
      ? report.completedTasks.map(formatTaskForPrompt).join("\n")
      : "Нет завершённых задач";

  const carryoverSection =
    report.carryoverTasks.length > 0
      ? report.carryoverTasks.map(formatTaskForPrompt).join("\n")
      : "Нет переходящих задач";

  const newSection =
    report.newTasks.length > 0
      ? report.newTasks.map(formatTaskForPrompt).join("\n")
      : "Нет новых задач";

  const trendSection = formatTrendForPrompt(trend);

  return `Ты — аналитик проектного управления. Проанализируй данные канбан-доски за неделю и сформируй структурированный аналитический отчёт.

Период: ${weekStart} — ${weekEnd}

ЗАВЕРШЁННЫЕ ЗАДАЧИ:
${completedSection}

ПЕРЕХОДЯЩИЕ ЗАДАЧИ (начаты до этой недели):
${carryoverSection}

НОВЫЕ ЗАДАЧИ (начаты на этой неделе):
${newSection}

ТРЕНД ЗА 4 НЕДЕЛИ:
${trendSection}

Верни ТОЛЬКО валидный JSON (без markdown, без комментариев) в следующем формате:
{
  "summary": "Краткое резюме недели в 2-3 предложения. Профессиональный аналитический тон.",
  "completionRate": "Процент выполнения и абсолютные числа, например: «75% (6 из 8 задач)»",
  "weekComparison": "Сравнение с предыдущей неделей: лучше/хуже, на сколько задач, динамика",
  "trends": "Анализ трендов за 4 недели: растёт ли производительность, стабильна ли нагрузка",
  "risks": ["Список рисков: задачи, застрявшие более 2 недель, перегрузка, снижение темпа и т.д."],
  "nextWeekFocus": ["Рекомендации на следующую неделю: на что обратить внимание, приоритеты"]
}

Требования:
- Пиши на русском языке
- Профессиональный аналитический тон
- Конкретные цифры и факты
- risks и nextWeekFocus — массивы строк (минимум 1 элемент в каждом)
- Если рисков нет — укажи «Значительных рисков не выявлено»`;
}

function getApiKey(): string {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set");
  return key;
}

export function parseAiResponse(raw: string): AiAnalysis {
  // Убираем markdown-обёртки если модель добавила ```json ... ```
  let cleaned = raw.trim();
  const jsonBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    cleaned = jsonBlockMatch[1].trim();
  }
  const parsed = JSON.parse(cleaned);
  return {
    summary: String(parsed.summary ?? ""),
    completionRate: String(parsed.completionRate ?? ""),
    weekComparison: String(parsed.weekComparison ?? ""),
    trends: String(parsed.trends ?? ""),
    risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
    nextWeekFocus: Array.isArray(parsed.nextWeekFocus) ? parsed.nextWeekFocus.map(String) : [],
  };
}

export async function getAiAnalysis(
  report: ExtendedWeeklyReport,
  trend: WeekTrendItem[],
): Promise<AiAnalysis> {
  const prompt = buildAiPrompt(report, trend);

  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_CHAT_MODEL,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: "Сформируй аналитический отчёт по предоставленным данным. Верни ТОЛЬКО JSON." },
      ],
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    console.error("Groq API error body:", errorBody);
    throw new Error(`Groq API error: ${res.status} — ${errorBody}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "";
  return parseAiResponse(content);
}
