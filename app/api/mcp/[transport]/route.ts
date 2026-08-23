import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { runTool, toMcpResult } from "@/lib/agent/tool-registry";
import { toolsFor } from "@/lib/agent/tools";
import { isValidAgentKey } from "@/lib/api-auth";

const handler = createMcpHandler(
  (server) => {
    // Инструменты берутся из общего реестра: тот же список видит телеграм-бот.
    for (const tool of toolsFor({ surface: "mcp" })) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
        },
        async (args) => toMcpResult(await runTool(tool, args))
      );
    }
  },
  { serverInfo: { name: "constance", version: "1.0.0" }, capabilities: { tools: {} } },
  { basePath: "/api/mcp", maxDuration: 60 }
);

const verifyToken = async (
  _req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> => {
  if (!isValidAgentKey(bearerToken)) return undefined;
  return { token: bearerToken!, scopes: ["board:write"], clientId: "agent" };
};

const authHandler = withMcpAuth(handler, verifyToken, { required: true });

export { authHandler as GET, authHandler as POST };
