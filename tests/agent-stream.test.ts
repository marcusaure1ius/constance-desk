import { describe, it, expect, vi } from "vitest";
import { handleAgentRequest, ndjsonStream } from "@/lib/agent/stream";
import type { AgentEvent } from "@/lib/agent/events";

async function readAll(response: Response): Promise<string> {
  return await response.text();
}

async function* fakeRun(): AsyncGenerator<AgentEvent> {
  yield { type: "thinking" };
  yield { type: "text", text: "готово" };
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("ndjsonStream", () => {
  it("кладёт события построчно", async () => {
    const response = new Response(ndjsonStream(fakeRun()));
    expect(await readAll(response)).toBe('{"type":"thinking"}\n{"type":"text","text":"готово"}\n');
  });
});

describe("handleAgentRequest", () => {
  const authorize = async () => true;

  it("без сессии отвечает 401 и не зовёт агента", async () => {
    const run = vi.fn();
    const response = await handleAgentRequest(post({ message: "привет", environmentId: "env_1" }), {
      run: run as never,
      authorize: async () => false,
    });

    expect(response.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("без сообщения отвечает 400", async () => {
    const response = await handleAgentRequest(post({ environmentId: "env_1" }), {
      run: fakeRun as never,
      authorize,
    });

    expect(response.status).toBe(400);
  });

  it("без среды отвечает 400", async () => {
    const response = await handleAgentRequest(post({ message: "привет" }), {
      run: fakeRun as never,
      authorize,
    });

    expect(response.status).toBe(400);
  });

  it("отдаёт поток событий и передаёт агенту сообщение со средой", async () => {
    const run = vi.fn(fakeRun);
    const response = await handleAgentRequest(
      post({ message: "что горит", environmentId: "env_1" }),
      { run: run as never, authorize }
    );

    expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
    expect(await readAll(response)).toContain('{"type":"text","text":"готово"}');
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ message: "что горит", environmentId: "env_1" })
    );
  });
});
