/**
 * Arguments passed by the LLM when it calls the present_choices native tool.
 */
export type PresentChoicesArgs = {
  /** Optional framing question shown above the choices in the UI */
  question?: string;
  /** Between 2 and 6 labelled options */
  choices: string[];
};

/**
 * Structured event emitted by the server when an agent calls present_choices.
 * Carried as the payload of the session.run.choices WebSocket event.
 */
export type ChoicesEvent = {
  runId: string;
  sessionId: string;
  agentId: string;
  question?: string;
  choices: string[];
};
