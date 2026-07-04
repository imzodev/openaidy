# RED-GREEN example (vitest)

This repo uses **vitest**, with tests colocated next to the file under
test as `*.test.ts`. Here is one full loop for a small function.

## RED — write the failing test first

`src/lib/slugify.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { slugify } from './slugify.js';

describe('slugify', () => {
  it('lowercases and hyphenates words', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });
});
```

Run only this file while iterating:

```bash
pnpm --filter @openaidy/server exec vitest run src/lib/slugify.test.ts
```

It fails because `slugify` doesn't exist yet. Good — that's RED for the
right reason.

## GREEN — minimum code to pass

`src/lib/slugify.ts`:

```ts
export function slugify(input: string): string {
  return input.toLowerCase().replace(/\s+/g, '-');
}
```

Re-run: green.

## Extend, still one behavior per test

```ts
it('strips punctuation', () => {
  expect(slugify('Hello, World!')).toBe('hello-world');
});

it('collapses repeated separators', () => {
  expect(slugify('a  --  b')).toBe('a-b');
});
```

Each new test fails first, then you extend `slugify` minimally to pass.

## REFACTOR

Once green, tidy the implementation (e.g. a single normalize pipeline)
and re-run the whole file after each edit. Green stays green.

## Conventions to match

- Import the unit under test with a `.js` extension (`./slugify.js`) —
  the repo's module resolution requires it even in `.ts` files.
- Keep tests deterministic: no real network, clock, or filesystem unless
  the test sets them up and tears them down.
- Prefer many small `it(...)` cases over one case with many assertions.
