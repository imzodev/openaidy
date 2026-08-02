/**
 * Skill contracts shared between the server registry, the HTTP routes that
 * serve them, and the web client that renders them.
 */

/**
 * A SKILL.md the registry refused to load, with the reasons why.
 *
 * Returned alongside `items` by `GET /skills` so operators can see why a skill
 * that exists on disk is missing from the catalog — silently dropping these is
 * what kept a broken skill invisible in the UI.
 */
export type SkillLoadError = {
  /** Skill id, derived from the name of the directory holding SKILL.md. */
  id: string;
  /** Path to the SKILL.md that failed to load. */
  filePath: string;
  /** Validation messages, in the order the parser produced them. */
  messages: string[];
  /**
   * Owning agent when the failing file lives in an agent workspace
   * (`<workspace>/<agentId>/skills/<id>/SKILL.md`). Absent for errors in the
   * global `SKILLS_DIR`.
   */
  agentId?: string;
};
