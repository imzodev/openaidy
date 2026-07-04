# Review checklist

Work top-down. Correctness findings are worth more than everything below
them combined.

## Correctness

- [ ] Conditions: any inverted logic, `&&`/`||` mixups, off-by-one?
- [ ] Wrong variable used (copy-paste from the line above)?
- [ ] Null/undefined: every access guaranteed non-null, or guarded?
- [ ] `await` on every promise; no floating async work?
- [ ] Falsy traps: `0`, `''`, `false` treated as "missing" when valid?
- [ ] Boundaries: empty collection, single element, max size, duplicates?
- [ ] Errors: caught only where handled; nothing swallowed silently?
- [ ] Removed code: did a deleted line enforce an invariant? Where is it now?

## Cross-file

- [ ] Callers updated for a changed signature / return shape / new throw?
- [ ] A parallel change in the same diff doesn't make another call unsafe?
- [ ] Concurrency/ordering assumptions still hold?

## Reuse & simplification

- [ ] Does this reinvent an existing helper? Name it.
- [ ] Duplicated logic that should be factored?
- [ ] Dead code, unreachable branch, unused export left behind?
- [ ] Simpler form that does the same job?

## Efficiency

- [ ] Repeated I/O or computation that could be hoisted or cached?
- [ ] Independent async operations run sequentially?
- [ ] Work added to a hot path or startup that doesn't belong there?

## Tests & docs

- [ ] New behavior covered by a test that would fail without the change?
- [ ] Bug fix accompanied by a regression test?
- [ ] Public API change reflected where the project documents such things?

## Severity ranking

1. Data loss / security / crash on a realistic input
2. Wrong result on a common case
3. Wrong result on an edge case
4. Cleanup / reuse / efficiency
5. Style not covered by the linter (usually skip)
