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

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of events) {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Сбой агента";
        controller.enqueue(encoder.encode(encodeEvent({ type: "error", message })));
      } finally {
        controller.close();
      }
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
