import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { IntelligenceAnalysisService, type McpAnalysisOptions } from "./analysis-service";
import { createTools, type RegisteredTool } from "./tools/index";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function write(message: JsonRpcResponse): void {
  output.write(`${JSON.stringify(message)}\n`);
}

function textContent(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export async function startMcpServer(options: McpAnalysisOptions = {}): Promise<void> {
  const service = new IntelligenceAnalysisService(options);
  const tools = createTools(service);
  const byName = new Map<string, RegisteredTool>(tools.map((tool) => [tool.name, tool]));
  const rl = createInterface({ input, crlfDelay: Infinity });

  rl.on("line", (line) => {
    void (async () => {
      if (line.trim() === "") return;
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(line) as JsonRpcRequest;
      } catch (error) {
        write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error", data: String(error) } });
        return;
      }
      if (request.id === undefined) return;
      try {
        write({ jsonrpc: "2.0", id: request.id, result: await handleRequest(request, byName) });
      } catch (error) {
        write({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
        });
      }
    })();
  });

  await new Promise<void>((resolvePromise) => rl.once("close", resolvePromise));
}

async function handleRequest(request: JsonRpcRequest, tools: Map<string, RegisteredTool>): Promise<unknown> {
  switch (request.method) {
    case "initialize":
      return {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "nextjs-intelligence", version: "0.1.2" },
      };
    case "ping":
      return {};
    case "tools/list":
      return {
        tools: [...tools.values()].map(({ handler: _handler, ...tool }) => tool),
      };
    case "tools/call": {
      if (!isObject(request.params)) throw new Error("tools/call params must be an object.");
      const name = request.params["name"];
      const args = request.params["arguments"];
      if (typeof name !== "string") throw new Error("tools/call params.name must be a string.");
      const tool = tools.get(name);
      if (!tool) throw new Error(`Unknown tool '${name}'.`);
      const result = await tool.handler(isObject(args) ? args : {});
      return textContent(result);
    }
    default:
      throw new Error(`Unsupported MCP method '${request.method}'.`);
  }
}
