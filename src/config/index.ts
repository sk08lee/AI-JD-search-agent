import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

export interface Config {
  llm: {
    apiKey: string;
    baseUrl: string;
    model: string;
  };
  embedding: {
    apiKey: string;
    baseUrl: string;
    model: string;
  };
  tools: {
    enableFetch: boolean;
    uvxCommand: string;
  };
  output: {
    directory: string;
  };
  knowledge: {
    directory: string;
  };
}

export function loadConfig(): Config {
  const configPath = path.join(process.cwd(), 'config', 'config.json');
  
  let fileConfig: Partial<Config> = {};
  if (fs.existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      console.warn('[Config] Failed to parse config.json, using defaults');
    }
  }

  return {
    llm: {
      apiKey: process.env.OPENAI_API_KEY || '',
      baseUrl: process.env.OPENAI_BASE_URL || '',
      model: process.env.OPENAI_MODEL || 'openai/gpt-4o-mini'
    },
    embedding: {
      apiKey: process.env.EMBEDDING_KEY || '',
      baseUrl: process.env.EMBEDDING_BASE_URL || '',
      model: process.env.EMBEDDING_MODEL || 'BAAI/bge-m3'
    },
    tools: {
      enableFetch: process.env.ENABLE_FETCH_MCP === '1',
      uvxCommand: process.env.UVX_COMMAND || 'uvx'
    },
    output: {
      directory: process.env.OUTPUT_DIR || './output'
    },
    knowledge: {
      directory: process.env.KNOWLEDGE_DIR || './knowledge'
    },
    ...fileConfig
  };
}