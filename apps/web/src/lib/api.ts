/**
 * API client for session endpoints
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/**
 * Session record
 */
export type Session = {
  id: string;
  title: string;
  createdAt: string;
};

/**
 * Message role
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Session message record
 */
export type SessionMessage = {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  sequence: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

/**
 * Run status
 */
export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/**
 * Session run record
 */
export type SessionRun = {
  id: string;
  sessionId: string;
  providerId: string;
  modelId: string;
  status: RunStatus;
  finishReason?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
};

/**
 * API error response
 */
export type ApiError = {
  error: string;
  message?: string;
  sessionId?: string;
};

/**
 * List sessions
 */
export async function listSessions(): Promise<{ items: Session[] }> {
  const response = await fetch(`${API_BASE}/sessions`);
  if (!response.ok) {
    throw new Error(`Failed to list sessions: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Create a new session
 */
export async function createSession(title: string): Promise<Session> {
  const response = await fetch(`${API_BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create session: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get a session by ID
 */
export async function getSession(id: string): Promise<Session | ApiError> {
  const response = await fetch(`${API_BASE}/sessions/${id}`);
  return response.json();
}

/**
 * List messages for a session
 */
export async function listMessages(sessionId: string): Promise<{ items: SessionMessage[] } | ApiError> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/messages`);
  return response.json();
}

/**
 * List runs for a session
 */
export async function listRuns(sessionId: string): Promise<{ items: SessionRun[] } | ApiError> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/runs`);
  return response.json();
}

/**
 * Submit message input
 */
export type SubmitMessageInput = {
  role: 'user' | 'system';
  content: string;
  providerId?: string;
  modelId?: string;
};

/**
 * Submit message result
 */
export type SubmitMessageResult =
  | {
      ok: true;
      userMessage: SessionMessage;
      assistantMessage: SessionMessage;
      run: SessionRun;
    }
  | {
      ok: false;
      error: { code: string; message: string };
    };

/**
 * Submit a message to a session
 */
export async function submitMessage(
  sessionId: string,
  input: SubmitMessageInput
): Promise<SubmitMessageResult> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return response.json();
}
