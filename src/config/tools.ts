export interface ToolConfig {
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
  requiredEnv?: string[];
}

export const toolConfigs: ToolConfig[] = [
  {
    name: 'mcp-server-fetch',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    enabled: false,
    requiredEnv: ['UVX_COMMAND']
  },
  {
    name: 'mcp-server-file',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', './output'],
    enabled: true
  }
];