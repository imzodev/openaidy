/**
 * Gemini Provider Types
 *
 * Type definitions for the Gemini provider adapter.
 */

// =====================
// Gemini API Types
// =====================

/**
 * Gemini content part (text)
 */
export type GeminiTextPart = {
  text: string;
};

/**
 * Gemini content part (inline data for images/audio)
 */
export type GeminiInlineDataPart = {
  inlineData: {
    mimeType: string;
    data: string;
  };
};
/**
 * Gemini function call part
 */
export type GeminiFunctionCallPart = {
  functionCall: {
    name: string;
    args: Record<string, unknown>;
  };
};

/**
 * Gemini function response part
 */
export type GeminiFunctionResponsePart = {
  functionResponse: {
    name: string;
    response: Record<string, unknown>;
  };
};

/**
 * Gemini content part union
 */
export type GeminiPart =
  | GeminiTextPart
  | GeminiInlineDataPart
  | GeminiFunctionCallPart
  | GeminiFunctionResponsePart;

/**
 * Gemini role
 */
export type GeminiRole = 'user' | 'model';

/**
 * Gemini content
 */
export type GeminiContent = {
  role: GeminiRole;
  parts: GeminiPart[];
};

/**
 * Gemini tool function declaration
 */
export type GeminiFunctionDeclaration = {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
};

/**
 * Gemini tool
 */
export type GeminiTool = {
  functionDeclarations: GeminiFunctionDeclaration[];
};

/**
 * Gemini safety setting
 */
export type GeminiSafetySetting = {
  category: string;
  threshold: string;
};

/**
 * Gemini generation config
 */
export type GeminiGenerationConfig = {
  temperature?: number;
  topP?: number;
  topK?: number;
  candidateCount?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  responseMimeType?: string;
};

/**
 * Gemini generate content request
 */
export type GeminiGenerateContentRequest = {
  contents: GeminiContent[];
  tools?: GeminiTool[];
  toolConfig?: {
    functionCallingConfig?: {
      mode?: 'AUTO' | 'ANY' | 'NONE';
    };
  };
  safetySettings?: GeminiSafetySetting[];
  generationConfig?: GeminiGenerationConfig;
  systemInstruction?: GeminiPart;
};

/**
 * Gemini response candidate
 */
export type GeminiCandidate = {
  content: {
    role: 'model';
    parts: GeminiPart[];
  };
  finishReason: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'TOOL_CALLS' | 'OTHER';
  safetyRatings?: Array<{
    category: string;
    probability: string;
  }>;
};
/**
 * Gemini generate content response
 */
export type GeminiGenerateContentResponse = {
  candidates: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
};

/**
 * Gemini streaming response chunk
 */
export type GeminiStreamChunk = {
  candidates: Array<{
    content: {
      role?: 'model';
      parts: GeminiPart[];
    };
    finishReason?: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'TOOL_CALLS' | 'OTHER';
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
};

/**
 * Gemini error response
 */
export type GeminiErrorResponse = {
  error: {
    code: number;
    message: string;
    status: string;
    details?: Array<{
      '@type': string;
      reason?: string;
      [key: string]: unknown;
    }>;
  };
};

/**
 * Gemini model
 */
export type GeminiModel = {
  name: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
};

/**
 * Gemini list models response
 */
export type GeminiListModelsResponse = {
  models: GeminiModel[];
};

// =====================
// Adapter Configuration
// =====================

/**
 * Gemini adapter configuration
 */
export type GeminiAdapterConfig = {
  /** API key for authentication */
  apiKey: string;
  /** Base URL for Gemini API */
  baseUrl?: string;
  /** Default model to use */
  defaultModel?: string;
  /** Project ID (for Vertex AI) */
  projectId?: string;
  /** Region (for Vertex AI) */
  region?: string;
  /** Use Vertex AI instead of AI Studio */
  useVertexAI?: boolean;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Enable streaming support */
  enableStreaming?: boolean;
  /** Enable tool/function calling */
  enableTools?: boolean;
  /** Enable vision capabilities */
  enableVision?: boolean;
  /** Enable audio input */
  enableAudioInput?: boolean;
  /** Provider ID override */
  providerId?: string;
  /** Provider name override */
  providerName?: string;
  /** Default temperature */
  defaultTemperature?: number;
  /** Default max tokens */
  defaultMaxTokens?: number;
  /** Safety settings */
  safetySettings?: GeminiSafetySetting[];
  /** System instruction */
  systemInstruction?: string;
};
