import { chatJson, MODELS, type LlmProvider } from "./client";

/**
 * Точечная помощь по полям задачи: переписать название, набросать описание.
 *
 * Это не агент: один вызов, никаких инструментов, никакого доступа к доске.
 * Поэтому и модель дешёвая — та же, что у разбора из формы.
 *
 * Ответ модели проверяется, и при мусоре возвращается исходное значение:
 * пользователь нажал «улучшить», а не «испортить».
 */

type Options = { providers?: LlmProvider[]; fetchFn?: typeof fetch };

export function buildTitlePrompt(): string {
  return `Ты правишь названия задач на канбан-доске.

Перепиши название так, чтобы оно начиналось с глагола в повелительном наклонении и читалось с одного взгляда. Убери канцелярит («нужно», «надо», «необходимо»), слова-паразиты вроде «ну», «короче», «в общем», «как-то так», ненужные вводные обороты и повторения, которые не несут информации.

Смысл менять нельзя: сохраняй названия систем, аббревиатуры, имена, числа, сроки и все фактические детали. Язык — тот же, что во входе.

Примеры правки:
• «Нужно обновить версию ПСН в системе» → «Обновить ПСН»
• «В общем, надо как-то описать требования для фронта» → «Описать требования фронтенда»

Верни JSON: { "title": "…" }`;
}

export function parseTitleResponse(raw: string): string | null {
  return pickString(raw, "title");
}

export async function improveTitle(title: string, options: Options = {}): Promise<string> {
  const { content } = await chatJson({
    system: buildTitlePrompt(),
    user: title,
    models: MODELS.smartInput,
    providers: options.providers,
    fetchFn: options.fetchFn,
  });

  return parseTitleResponse(content) ?? title;
}

export function buildDescriptionPrompt(today: string): string {
  return `Ты помогаешь владельцу канбан-доски дописать описание задачи. Сегодня: ${today}.

Опиши задачу в три коротких блока: зачем она, что сделать (2–4 пункта списком) и по чему поймём, что готово.

Не выдумывай фактов, которых нет в названии и текущем описании: ни имён, ни систем, ни сроков. Если данных мало — пиши общее, но по делу. Язык — русский, без воды и без вступлений.

Верни JSON: { "description": "…" }`;
}

export function parseDescriptionResponse(raw: string): string | null {
  return pickString(raw, "description");
}

export async function draftDescription(
  input: { title: string; description: string },
  options: Options = {}
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);

  const { content } = await chatJson({
    system: buildDescriptionPrompt(today),
    user: JSON.stringify(input),
    models: MODELS.smartInput,
    providers: options.providers,
    fetchFn: options.fetchFn,
  });

  return parseDescriptionResponse(content) ?? input.description;
}

function pickString(raw: string, field: string): string | null {
  try {
    const value = (JSON.parse(raw) as Record<string, unknown>)[field];
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}
