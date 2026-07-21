/**
 * Component Manifest — JSDoc-derived, agent-discoverable
 *
 * Parses `@component` JSDoc blocks directly out of `openaidy-sdk.js` at
 * request time and turns them into the structured manifest served by
 * `GET /sdk/components.json`. This is deliberately a SEPARATE source from
 * `sdk-reference.ts`'s hand-authored `SDK_METHODS` array: this file describes
 * the same `sdk.ui.*` surface, but reads it straight from the .js source so
 * the manifest can never drift from the actual runtime implementation —
 * adding a component is "add the JSDoc block + implementation", nothing else.
 *
 * No JSDoc-parsing library exists anywhere in this monorepo (checked), and the
 * codebase generally favors small hand-rolled parsers over new dependencies
 * for this kind of narrowly-scoped text extraction (see the CSP/domain regex
 * logic in routes/addons.ts and tools/addons/create.ts) — this follows that
 * precedent rather than pulling in e.g. `comment-parser`.
 */

export type ComponentManifestParam = {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly description: string;
};

export type ComponentManifestEntry = {
  readonly name: string;
  readonly namespace: string;
  readonly description: string;
  readonly params: readonly ComponentManifestParam[];
  readonly returns: string;
};

export type ComponentManifest = {
  readonly version: string;
  readonly components: readonly ComponentManifestEntry[];
};

/** Matches a JSDoc block immediately followed by `name: function`. */
const JSDOC_METHOD_RE =
  /\/\*\*([\s\S]*?)\*\/\s*([A-Za-z_$][\w$]*)\s*:\s*function/g;

/**
 * Matches a `@param {type} name - description` (or `{type} [name] -
 * description` for an optional param) line, after `*`-prefix stripping.
 */
const PARAM_LINE_RE = /^@param\s+\{([^}]+)\}\s+(\[[^\]]+\]|\S+)\s*-\s*(.*)$/;

/** Strip the leading `*`/whitespace JSDoc comment lines carry. */
function stripCommentPrefix(raw: string): string[] {
  return raw.split('\n').map((line) => line.replace(/^\s*\*\s?/, '').trim());
}

function parseParamLine(line: string): ComponentManifestParam | null {
  const match = PARAM_LINE_RE.exec(line);
  if (!match) return null;
  const type = match[1] as string;
  const rawName = match[2] as string;
  const description = match[3] as string;
  const required = !rawName.startsWith('[');
  const name = rawName.replace(/^\[|\]$/g, '').split('=')[0] as string;
  return { name, type, required, description };
}

/**
 * Parse every `@component`-tagged JSDoc block in `sdkSource` into a
 * {@link ComponentManifest}. Blocks without `@component` are ignored, so this
 * only ever picks up `sdk.ui.*` (or any future namespace opted in the same
 * way) — not the rest of the SDK's plain one-line doc comments.
 */
export function parseComponentManifest(
  sdkSource: string,
  version = '1.0.0',
): ComponentManifest {
  const components: ComponentManifestEntry[] = [];

  for (const match of sdkSource.matchAll(JSDOC_METHOD_RE)) {
    const [, rawComment, name] = match as unknown as [string, string, string];
    if (!rawComment.includes('@component')) continue;

    const lines = stripCommentPrefix(rawComment);
    let namespace = '';
    let description = '';
    let returns = 'void';
    const params: ComponentManifestParam[] = [];

    for (const line of lines) {
      if (line.startsWith('@namespace')) {
        namespace = line.slice('@namespace'.length).trim();
      } else if (line.startsWith('@description')) {
        description = line.slice('@description'.length).trim();
      } else if (line.startsWith('@returns')) {
        const returnMatch = /\{([^}]+)\}/.exec(line);
        if (returnMatch) returns = returnMatch[1] as string;
      } else if (line.startsWith('@param')) {
        const param = parseParamLine(line);
        if (param) params.push(param);
      }
    }

    components.push({ name, namespace, description, params, returns });
  }

  return { version, components };
}
