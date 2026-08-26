import { cookies } from "next/headers";
import { isSessionValid, SESSION_COOKIE } from "@/lib/session";
import type { ChatMessage } from "@/lib/llm/chat-tools";
import { encodeEvent, type AgentEvent } from "./events";
import { runAgent } from "./loop";

/**
 * HTTP-обвязка агента. Логика здесь, а не в роуте: роут — шим, его в тестах
 * не поднять, а проверять нужно и авторизацию, и разбор тела, и поток.
 */

export type AgentRequestBody = {
  message?: string;
  history?: ChatMessage[];
  environmentId?: string;
};

export function ndjsonStream(events: AsyncIterable<AgentEvent>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  // Итератор берём один раз: в start() крутим его вручную, а в cancel()
  // зовём iterator.return() — это и есть единственный способ прервать
  // for-await посередине. Без этого обрыв соединения (закрытая вкладка,
  // отменённый fetch) не имеет колбэка, и generator runAgent продолжает
  // тянуть шаги (а значит — звать модель и инструменты) вникуда.
  const iterator = events[Symbol.asyncIterator]();

  return new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { value, done } = await iterator.next();
          if (done) break;
          controller.enqueue(encoder.encode(encodeEvent(value)));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Сбой агента";
        try {
          controller.enqueue(encoder.encode(encodeEvent({ type: "error", message })));
        } catch {
          // Поток уже отменён (cancel() успел раньше) — класть событие некуда,
          // это не повод ронять обработчик необработанным исключением.
        }
      } finally {
        try {
          controller.close();
        } catch {
          // cancel() уже закрыл контроллер сам — повторный close() бросает,
          // это ожидаемо и не является ошибкой.
        }
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

async function authorizeBySession(): Promise<boolean> {
  const store = await cookies();
  return isSessionValid(store.get(SESSION_COOKIE)?.value);
}

export async function handleAgentRequest(
  request: Request,
  deps: {
    run?: typeof runAgent;
    authorize?: (request: Request) => Promise<boolean>;
  } = {}
): Promise<Response> {
  const run = deps.run ?? runAgent;
  const authorize = deps.authorize ?? (() => authorizeBySession());

  if (!(await authorize(request))) {
    return Response.json({ error: "Нужна авторизация" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as AgentRequestBody;
  const message = body.message?.trim();
  const environmentId = body.environmentId?.trim();

  if (!message) return Response.json({ error: "Пустое сообщение" }, { status: 400 });
  if (!environmentId) return Response.json({ error: "Не указана среда" }, { status: 400 });

  const events = run({ message, environmentId, history: body.history });

  return new Response(ndjsonStream(events), {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
