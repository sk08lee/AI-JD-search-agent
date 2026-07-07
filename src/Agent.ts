import MCPClient from "./MCPClient.js";
import ChatOpenAI from "./ChatOpenAI.js";
import { logTitle } from "./utils.js";

export default class Agent {
    private mcpClients: MCPClient[];
    private activeMcpClients: MCPClient[] = [];
    private llm: ChatOpenAI | null = null;
    private model: string;
    private systemPrompt: string;
    private context: string;

    constructor(model: string, mcpClients: MCPClient[], systemPrompt: string = '', context: string = '') {
        this.mcpClients = mcpClients;
        this.model = model;
        this.systemPrompt = systemPrompt;
        this.context = context;
    }

    async init() {
        logTitle('INIT LLM AND TOOLS');
        this.activeMcpClients = [];

        for (const client of this.mcpClients) {
            try {
                await client.init();
                this.activeMcpClients.push(client);
            } catch (e: any) {
                console.warn(
                    `[MCP degraded] ${client.getName()} unavailable, continuing without it: ${String(e?.message ?? e)}`
                );
            }
        }
        const tools = this.activeMcpClients.flatMap(client => client.getTools());
        this.llm = new ChatOpenAI(this.model, this.systemPrompt, tools, this.context);
    }

    async close() {
        for (const client of this.activeMcpClients) {
            try {
                await client.close();
            } catch (e: any) {
                console.warn(`[MCP close skipped] ${client.getName()}: ${String(e?.message ?? e)}`);
            }
        }
    }

    async invoke(prompt: string) {
        if (!this.llm) throw new Error('Agent not initialized');
        let response = await this.llm.chat(prompt);
        while (true) {
            if (response.toolCalls.length > 0) {
                for (const toolCall of response.toolCalls) {
                    const mcp = this.activeMcpClients.find(client => client.getTools().some((t: any) => t.name === toolCall.function.name));
                    if (mcp) {
                        logTitle(`TOOL USE`);
                        console.log(`Calling tool: ${toolCall.function.name}`);
                        console.log(`Arguments: ${toolCall.function.arguments}`);
                        const argsRaw = toolCall.function.arguments ?? '';
                        const args = this.safeParseToolArgs(argsRaw);
                        this.normalizeToolArgs(toolCall.function.name, args);
                        const result = await mcp.callTool(toolCall.function.name, args);
                        console.log(`Result: ${JSON.stringify(result)}`);
                        this.llm.appendToolResult(toolCall.id, JSON.stringify(result));
                    } else {
                        this.llm.appendToolResult(toolCall.id, 'Tool not found');
                    }
                }
                // 工具调用后,继续对话
                response = await this.llm.chat();
                continue
            }
            // 没有工具调用,结束对话
            await this.close();
            return response.content;
        }
    }

    private safeParseToolArgs(argsRaw: string): any {
        const trimmed = (argsRaw ?? '').trim();
        if (!trimmed) return {};
        try {
            return JSON.parse(trimmed);
        } catch (e: any) {
            // Some models emit non-JSON / partial JSON; don't hard-crash the agent.
            return { _raw: argsRaw, _parseError: String(e?.message ?? e) };
        }
    }

    private normalizeToolArgs(toolName: string, args: any) {
        if (!args || typeof args !== 'object') return;

        // Filesystem MCP server typically expects paths relative to allowed roots.
        // Models often emit absolute-ish paths like "/file.md" which become outside-root on Windows.
        if (typeof (args as any).path === 'string') {
            (args as any).path = (args as any).path.replace(/^[\/\\]+/, '');
        }

        // Some tools use "source" / "destination" instead of "path". Normalize those too.
        for (const k of ['source', 'destination', 'from', 'to']) {
            if (typeof (args as any)[k] === 'string') {
                (args as any)[k] = (args as any)[k].replace(/^[\/\\]+/, '');
            }
        }
    }
}
