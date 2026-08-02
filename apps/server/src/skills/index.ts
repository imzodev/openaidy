/**
 * Skills module barrel export
 */

export { SkillRegistry, createSkillRegistry } from './registry.js';
// `SkillLoadError` is deliberately not re-exported here — it is part of the
// shared contract and must be imported from `@openaidy/shared-types`.
export type { SkillRegistryOptions, SkillSummary } from './registry.js';
export { parseSkillMd } from './parser.js';
export type { SkillDefinition, SkillParseError } from './parser.js';
export {
  sanitizeSkillBody,
  isBodySizeValid,
  MAX_BODY_SIZE,
} from './sanitize.js';
