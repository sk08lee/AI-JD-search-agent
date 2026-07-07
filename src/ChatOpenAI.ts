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
        const stream = await this.llm.chat.completions.create({
            model: this.model,
            messages: this.messages,
            stream: true,
            tools: this.getToolsDefinition(),
        });
        let content = "";
        let toolCalls: ToolCall[] = [];
        logTitle('RESPONSE');
        for await (const chunk of stream) {
            const choice = chunk.choices?.[0];
            const delta = choice?.delta;
            // 部分兼容层/事件 chunk 可能不含 choices/delta，直接跳过
            if (!delta) continue;
            // 处理普通Content
            if (delta.content) {
                const contentChunk = delta.content || "";
                content += contentChunk;
                process.stdout.write(contentChunk);
            }
            // 处理ToolCall
            if (delta.tool_calls) {
                for (const toolCallChunk of delta.tool_calls) {
                    // 第一次要创建一个toolCall
                    if (toolCalls.length <= toolCallChunk.index) {
                        toolCalls.push({ id: '', function: { name: '', arguments: '' } });
                    }
                    let currentCall = toolCalls[toolCallChunk.index];
                    if (toolCallChunk.id) currentCall.id += toolCallChunk.id;
                    if (toolCallChunk.function?.name) currentCall.function.name += toolCallChunk.function.name;
                    if (toolCallChunk.function?.arguments) currentCall.function.arguments += toolCallChunk.function.arguments;
                }
            }
        }
        this.messages.push({ role: "assistant", content: content, tool_calls: toolCalls.map(call => ({ id: call.id, type: "function", function: call.function })) });
        return {
            content: content,
            toolCalls: toolCalls,
        };
    }

    //追加工具执行结果到工具执行历史中
    public appendToolResult(toolCallId: string, toolOutput: string) {
        this.messages.push({
            role: "tool",
            content: toolOutput,
            tool_call_id: toolCallId
        });
    }

    //将MCP格式的工具转化为stream格式的工具
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
