/**
 * Agent Personality File types
 *
 * These types describe the four markdown files that define an agent's
 * identity, user context, mission, and behavioural rules.
 * Files are stored in .openaidy/workspaces/<agentId>/ and injected
 * into the system prompt at dispatch time.
 */

/**
 * The four personality file identifiers.
 * Each maps to a well-known markdown file in the agent workspace.
 */
export type PersonalityFileId = 'USER' | 'AGENT' | 'MISSION' | 'RULES';

/**
 * Metadata describing a single personality file.
 */
export type PersonalityFileMeta = {
  id: PersonalityFileId;
  filename: string;
  label: string;
  description: string;
  systemPromptBlock: string;
};

/**
 * A personality file's content as returned by the API.
 */
export type PersonalityFile = {
  id: PersonalityFileId;
  content: string;
  exists: boolean;
};

/**
 * Request body for updating a personality file.
 */
export type UpdatePersonalityFileInput = {
  content: string;
};
