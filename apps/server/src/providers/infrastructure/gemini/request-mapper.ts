/**
 * Gemini Request Mapper
 *
 * Maps normalized internal requests to Gemini API payloads.
 */

import type { Message, ModelRequest, ToolDefinition } from '@openaidy/runtime';
import type {
  GeminiContent,
  GeminiPart,
  GeminiTool,
  GeminiFunctionDeclaration,
  GeminiGenerateContentRequest,
  GeminiGenerationConfig,
  GeminiSafetySetting,
} from './types';

// =====================
// Message Mapping
// =====================

/**
 * Maps a normalized message role to Gemini role
 */
export function mapRole(role: Message['role']): 'user' | 'model' {
  switch (role) {
    case 'user':
      return 'user';
    case 'assistant':
      return 'model';
    case 'system':
    case 'tool':
      // System and tool messages are handled differently in Gemini
      // System is passed via systemInstruction
      // Tool results are mapped to user messages with functionResponse
      return 'user';
    default: {
      const _exhaustive: never = role;
      throw new Error(`Unknown message role: ${_exhaustive}`);
    }
  }
}

/**
 * Maps a normalized message to Gemini content format
 */
export function mapMessage(message: Message): GeminiContent {
  switch (message.role) {
    case 'system':
      // System messages are handled separately via systemInstruction
      // If we reach here, treat as user message
      return {
        role: 'user',
        parts: [{ text: message.content }],
      };

    case 'user':
      return {
        role: 'user',
        parts: [{ text: message.content }],
      };

    case 'assistant': {
      const parts: GeminiPart[] = [];
      
      // Add text content if present
      if (message.content) {
        parts.push({ text: message.content });
      }
      
      // Map tool calls to function calls
      if (message.toolCalls && message.toolCalls.length > 0) {
        for (const toolCall of message.toolCalls) {
          parts.push({
            functionCall: {
              name: toolCall.name,
              args: JSON.parse(toolCall.arguments),
            },
          } as GeminiPart);
        }
      }
      
      // Ensure at least one part
      if (parts.length === 0) {
        parts.push({ text: '' });
      }
      
      return {
        role: 'model',
        parts,
      };
    }

    case 'tool':
      // Tool result is mapped as a function response
      return {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: message.toolCallId ?? 'unknown',
              response: message.content ? JSON.parse(message.content) : {},
            },
          } as GeminiPart,
        ],
      };

    default: {
      const _exhaustive: never = message;
      throw new Error(`Unknown message role: ${_exhaustive}`);
    }
  }
}

/**
 * Maps all messages to Gemini content format
 * Filters out system messages (handled via systemInstruction)
 */
export function mapMessages(messages: readonly Message[]): GeminiContent[] {
  return messages
    .filter((msg) => msg.role !== 'system')
    .map(mapMessage);
}

/**
 * Extracts system instruction from messages
 */
export function extractSystemInstruction(messages: readonly Message[]): string | undefined {
  const systemMessages = messages.filter((msg) => msg.role === 'system');
  if (systemMessages.length === 0) return undefined;
  return systemMessages.map((msg) => msg.content).join('\n\n');
}

// =====================
// Tool Mapping
// =====================

/**
 * Maps a normalized tool definition to Gemini function declaration
 */
export function mapTool(tool: ToolDefinition): GeminiFunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as Record<string, unknown>,
  };
}

/**
 * Maps all tools to Gemini tool format
 */
export function mapTools(tools: readonly ToolDefinition[]): GeminiTool[] {
  if (tools.length === 0) return [];
  
  return [
    {
      functionDeclarations: tools.map(mapTool),
    },
  ];
}

/**
 * Maps tool choice to Gemini function calling config
 */
export function mapToolChoice(
  toolChoice?: 'auto' | 'required' | 'none'
): { functionCallingConfig: { mode: 'AUTO' | 'ANY' | 'NONE' } } | undefined {
  if (!toolChoice) return undefined;
  
  const modeMap: Record<string, 'AUTO' | 'ANY' | 'NONE'> = {
    auto: 'AUTO',
    required: 'ANY',
    none: 'NONE',
  };
  
  const mode = modeMap[toolChoice];
  if (!mode) return undefined;
  
  return {
    functionCallingConfig: {
      mode,
    },
  };
}

// =====================
// Generation Config Mapping
// =====================

/**
 * Maps request parameters to Gemini generation config
 */
export function mapGenerationConfig(
  request: ModelRequest,
  defaults?: {
    defaultTemperature?: number;
    defaultMaxTokens?: number;
  }
): GeminiGenerationConfig {
  const config: GeminiGenerationConfig = {};
  
  if (request.temperature !== undefined) {
    config.temperature = request.temperature;
  } else if (defaults?.defaultTemperature !== undefined) {
    config.temperature = defaults.defaultTemperature;
  }
  
  if (request.maxTokens !== undefined) {
    config.maxOutputTokens = request.maxTokens;
  } else if (defaults?.defaultMaxTokens !== undefined) {
    config.maxOutputTokens = defaults.defaultMaxTokens;
  }
  
  if (request.topP !== undefined) {
    config.topP = request.topP;
  }
  
  if (request.stopSequences !== undefined && request.stopSequences.length > 0) {
    config.stopSequences = [...request.stopSequences];
  }
  
  return config;
}

// =====================
// Request Mapping
// =====================

/**
 * Maps a normalized model request to Gemini generate content request
 */
export function mapRequest(
  request: ModelRequest,
  options?: {
    defaultTemperature?: number;
    defaultMaxTokens?: number;
    safetySettings?: GeminiSafetySetting[];
    systemInstruction?: string;
  }
): GeminiGenerateContentRequest {
  // Extract system instruction from messages or use provided one
  const systemFromMessages = extractSystemInstruction(request.messages);
  const systemInstruction = options?.systemInstruction ?? systemFromMessages;
  
  // Build generation config options, filtering out undefined values
  const genConfigOptions: { defaultTemperature?: number; defaultMaxTokens?: number } = {};
  if (options?.defaultTemperature !== undefined) {
    genConfigOptions.defaultTemperature = options.defaultTemperature;
  }
  if (options?.defaultMaxTokens !== undefined) {
    genConfigOptions.defaultMaxTokens = options.defaultMaxTokens;
  }
  
  const geminiRequest: GeminiGenerateContentRequest = {
    contents: mapMessages(request.messages),
    generationConfig: mapGenerationConfig(request, genConfigOptions),
  };
  
  // Add system instruction if present
  if (systemInstruction) {
    geminiRequest.systemInstruction = { text: systemInstruction };
  }
  
  // Add safety settings if provided
  if (options?.safetySettings && options.safetySettings.length > 0) {
    geminiRequest.safetySettings = options.safetySettings;
  }
  
  // Map tools if present
  if (request.tools && request.tools.length > 0) {
    geminiRequest.tools = mapTools(request.tools);
    
    const toolConfig = mapToolChoice(request.toolChoice);
    if (toolConfig) {
      geminiRequest.toolConfig = toolConfig;
    }
  }
  
  return geminiRequest;
}
