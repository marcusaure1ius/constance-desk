import { handleAgentRequest } from "@/lib/agent/stream";

// Логика — в lib/agent/stream.ts. Здесь только точка входа: роут в тестах
// не поднимается, а проверять авторизацию и поток нужно.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleAgentRequest(request);
}
