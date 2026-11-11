// Model-provider abstraction. DOM-free: runs in the browser (fetch) and in Node tests (fake fetch).

export type ProviderKind = 'ollama' | 'openai';

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl: string;
  model: string;
  /** cloud keys only; stored on this device, never exported */
  apiKey?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** JSON schema: ask for structured output (Ollama `format`, OpenAI `response_format`) */
  schema?: object;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onToken?: (text: string) => void;
  /** reasoning text from thinking models (kept out of the answer); useful as a progress signal */
  onThinking?: (text: string) => void;
}

export interface ChatResult {
  text: string;
  /** parsed JSON when a schema was requested */
  json?: unknown;
  usage?: { input?: number; output?: number };
  ms: number;
}

export interface ModelInfo {
  id: string;
  detail: string;
}

export interface Provider {
  config: ProviderConfig;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  /** short server description, e.g. "Ollama 0.40.16" */
  version(signal?: AbortSignal): Promise<string>;
  chat(req: ChatRequest): Promise<ChatResult>;
}

export type AiErrorCode =
  | 'unreachable' | 'cors' | 'auth' | 'model_not_found' | 'no_model'
  | 'http' | 'bad_response' | 'aborted';

export class AiError extends Error {
  code: AiErrorCode;
  hint: string;
  status?: number;
  constructor(code: AiErrorCode, message: string, hint = '', status?: number) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.hint = hint;
    this.status = status;
  }
}
