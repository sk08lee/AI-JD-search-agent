import MCPClient from "./MCPClient.js";
import ChatOpenAI, { type ToolCall } from "./ChatOpenAI.js";
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
        let response = await this.invokeWithoutClose(prompt);
        while (response.toolCalls.length > 0) {
            response = await this.continueAfterTools(response);
        }
        await this.close();
        return response.content;
    }

    async invokeWithoutClose(prompt: string): Promise<{ content: string; toolCalls: ToolCall[] }> {
        if (!this.llm) throw new Error('Agent not initialized');
        return this.llm.chat(prompt);
    }

    async continueAfterTools(previous: { toolCalls: ToolCall[] }): Promise<{ content: string; toolCalls: ToolCall[] }> {
        if (!this.llm) throw new Error('Agent not initialized');
        if (previous.toolCalls.length === 0) {
            return { content: '', toolCalls: [] };
        }

        await this.executeToolCalls(previous.toolCalls);
        return this.llm.chat();
    }

    private async executeToolCalls(toolCalls: ToolCall[]) {
        if (!this.llm) throw new Error('Agent not initialized');

        for (const toolCall of toolCalls) {
            const mcp = this.activeMcpClients.find((client) =>
                client.getTools().some((tool: { name: string }) => tool.name === toolCall.function.name)
            );
            if (mcp) {
                logTitle('TOOL USE');
                console.log(`Calling tool: ${toolCall.function.name}`);
                console.log(`Arguments: ${toolCall.function.arguments}`);
                const argsRaw = toolCall.function.arguments ?? '';
                const args = this.safeParseToolArgs(argsRaw);
                this.normalizeToolArgs(toolCall.function.name, args);
                const result = await mcp.callTool(toolCall.function.name, args);
                console.log(`Result: ${JSON.stringify(result).slice(0, 500)}`);
                this.llm.appendToolResult(toolCall.id, JSON.stringify(result));
            } else {
                this.llm.appendToolResult(toolCall.id, 'Tool not found');
            }
        }
    }

    private safeParseToolArgs(argsRaw: string): any {
        const trimmed = (argsRaw ?? '').trim();
        if (!trimmed) return {};
        try {
            return JSON.parse(trimmed);
        } catch (e: any) {
            return { _raw: argsRaw, _parseError: String(e?.message ?? e) };
        }
    }

    private normalizeToolArgs(toolName: string, args: any) {
        if (!args || typeof args !== 'object') return;

        if (typeof (args as any).path === 'string') {
            (args as any).path = (args as any).path.replace(/^[\/\\]+/, '');
        }

        for (const k of ['source', 'destination', 'from', 'to']) {
            if (typeof (args as any)[k] === 'string') {
                (args as any)[k] = (args as any)[k].replace(/^[\/\\]+/, '');
            }
        }
    }
}
