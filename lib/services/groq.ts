const GROQ_API_URL = "https://api.groq.com/openai/v1";
const GROQ_CHAT_MODEL = "gpt-oss-20b";
const GROQ_WHISPER_MODEL = "whisper-large-v3";

export type ParsedTask = {
  title: string;
  priority?: "urgent" | "high" | "normal";
  plannedDate?: string;
};

const SYSTEM_PROMPT = `Ты — ассистент канбан-доски. Твоя задача — разобрать входящий текст пользователя на отдельные задачи.

Текст может быть:
- Скопирован из мессенджера (Telegram, Slack)
- Надиктован голосом (может содержать слова-паразиты, повторы)
- Написан в свободной форме, несколько задач в одном потоке

Для каждой задачи извлеки:
- title (обязательно) — краткое, чёткое название задачи в повелительном наклонении. Убери мусор, слова-паразиты, вводные слова. Пример: "ну ещё надо бы починить этот баг с логином" → "Починить баг с логином"
- priority — определи по контексту:
  - "urgent" — слова: срочно, ASAP, горит, критично, блокер
  - "high" — слова: важно, приоритетно, нужно побыстрее
  - "normal" — по умолчанию, если нет явных маркеров
- plannedDate — если указан срок, преобразуй в формат "yyyy-MM-dd". Сегодня: {today}. Примеры:
  - "до пятницы" → ближайшая пятница
  - "к 10 апреля" → "2026-04-10"
  - "на следующей неделе" → понедельник следующей недели
  - Если срок не указан — не включай поле

Верни JSON:
{
  "tasks": [
    { "title": "...", "priority": "normal" },
    { "title": "...", "priority": "urgent", "plannedDate": "2026-04-10" }
  ]
}

Правила:
- Если текст содержит одну задачу — верни массив из одного элемента
- Не выдумывай задачи, которых нет в тексте
- Не объединяй разные задачи в одну
- Если текст невозможно разобрать на задачи — верни { "tasks": [] }`;

export function buildParseTasksPrompt(userText: string, today: string) {
  return SYSTEM_PROMPT.replace("{today}", today);
}

export function parseTasksResponse(raw: string): ParsedTask[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.tasks)) return [];
    return parsed.tasks.filter(
      (t: Record<string, unknown>) => typeof t.title === "string" && t.title.trim().length > 0
    );
  } catch {
    return [];
  }
}

function getApiKey(): string {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set");
  return key;
}

export async function parseTasks(text: string): Promise<ParsedTask[]> {
  const today = new Date().toISOString().split("T")[0];
  const systemPrompt = buildParseTasksPrompt(text, today);

  const res = await fetch(`${GROQ_API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_CHAT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    throw new Error(`Groq API error: ${res.status}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "";
  return parseTasksResponse(content);
}

export async function transcribeAudio(audioFile: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", audioFile);
  formData.append("model", GROQ_WHISPER_MODEL);
  formData.append("language", "ru");
  formData.append("response_format", "json");

  const res = await fetch(`${GROQ_API_URL}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Groq transcription error: ${res.status}`);
  }

  const data = await res.json();
  return data.text ?? "";
}
