import OpenAI from "openai";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import 'dotenv/config';
import { logTitle } from "./utils.js";

export interface ToolCall {
    id: string;
    function: {
        name: string;
        arguments: string;
    };
}

export default class ChatOpenAI {
    private llm: OpenAI;
    private model: string;
    private messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    private tools: Tool[];

    constructor(model: string, systemPrompt: string = '', tools: Tool[] = [], context: string = '') {
        this.llm = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            baseURL: process.env.OPENAI_BASE_URL,
            timeout: Number(process.env.LLM_TIMEOUT_MS || 120000),
            maxRetries: 0
        });
        this.model = model;
        this.tools = tools;
        if (systemPrompt) this.messages.push({ role: "system", content: systemPrompt });
        if (context) this.messages.push({ role: "user", content: context });
    }

    async chat(prompt?: string): Promise<{ content: string, toolCalls: ToolCall[] }> {
        logTitle('CHAT');
        if (prompt) {
            this.messages.push({ role: "user", content: prompt });
        }

        const maxRetries = Number(process.env.LLM_MAX_RETRIES || 2);
        const useStream = process.env.LLM_USE_STREAM === '1';
        let lastError: unknown;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                if (useStream) {
                    return await this.chatWithStream();
                }
                return await this.chatWithoutStream();
            } catch (error) {
                lastError = error;
                if (attempt >= maxRetries) break;
                console.warn(`[LLM retry] attempt ${attempt + 1} failed: ${String(error instanceof Error ? error.message : error)}`);
                await sleep(1000 * (attempt + 1));
            }
        }

        throw lastError;
    }

    public appendToolResult(toolCallId: string, toolOutput: string) {
        this.messages.push({
            role: "tool",
            content: toolOutput,
            tool_call_id: toolCallId
        });
    }

    private async chatWithoutStream(): Promise<{ content: string, toolCalls: ToolCall[] }> {
        logTitle('RESPONSE');
        const response = await this.llm.chat.completions.create({
            model: this.model,
            messages: this.messages,
            stream: false,
            tools: this.getToolsDefinition().length > 0 ? this.getToolsDefinition() : undefined
        });

        const choice = response.choices[0];
        const content = choice?.message?.content || '';
        const toolCalls = (choice?.message?.tool_calls || []).map((call) => ({
            id: call.id,
            function: {
                name: call.function.name,
                arguments: call.function.arguments
            }
        }));

        if (content) {
            process.stdout.write(content);
        }

        this.messages.push({
            role: "assistant",
            content,
            tool_calls: toolCalls.map((call) => ({ id: call.id, type: "function" as const, function: call.function }))
        });

        return { content, toolCalls };
    }

    private async chatWithStream(): Promise<{ content: string, toolCalls: ToolCall[] }> {
        const stream = await this.llm.chat.completions.create({
            model: this.model,
            messages: this.messages,
            stream: true,
            tools: this.getToolsDefinition()
        });

        let content = "";
        let toolCalls: ToolCall[] = [];
        logTitle('RESPONSE');

        for await (const chunk of stream) {
            const choice = chunk.choices?.[0];
            const delta = choice?.delta;
            if (!delta) continue;

            if (delta.content) {
                const contentChunk = delta.content || "";
                content += contentChunk;
                process.stdout.write(contentChunk);
            }

            if (delta.tool_calls) {
                for (const toolCallChunk of delta.tool_calls) {
                    if (toolCalls.length <= toolCallChunk.index) {
                        toolCalls.push({ id: '', function: { name: '', arguments: '' } });
                    }
                    const currentCall = toolCalls[toolCallChunk.index];
                    if (toolCallChunk.id) currentCall.id += toolCallChunk.id;
                    if (toolCallChunk.function?.name) currentCall.function.name += toolCallChunk.function.name;
                    if (toolCallChunk.function?.arguments) currentCall.function.arguments += toolCallChunk.function.arguments;
                }
            }
        }

        this.messages.push({
            role: "assistant",
            content,
            tool_calls: toolCalls.map((call) => ({ id: call.id, type: "function", function: call.function }))
        });

        return { content, toolCalls };
    }

    private getToolsDefinition(): OpenAI.Chat.Completions.ChatCompletionTool[] {
        return this.tools.map((tool) => ({
            type: "function" as const,
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
            },
        }));
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
