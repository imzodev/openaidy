# Automation recipe

A reliable browser flow is a loop of small, verified steps — not one long
script. Repeat this loop per step.

## The step loop

1. **Observe** — capture the current URL and the relevant page content.
2. **Locate** — find the target element by visible label, role, or text.
3. **Act** — one action (click, type, select, navigate).
4. **Wait** — for the condition that means the action landed (URL change,
   new element, network idle) — not a fixed timer.
5. **Verify** — confirm the expected result appeared before the next step.
6. **Capture** — screenshot at decisions and on any failure.

## Selector priority

1. Accessible role + name / visible label text.
2. Stable `id`, `name`, or `data-testid` attributes.
3. Text content of a unique element.
4. CSS/xpath tied to generated class names — last resort, brittle.

## When to stop and ask

- [ ] A login wall or CAPTCHA blocks the flow.
- [ ] The page differs from what the task assumed.
- [ ] The next step spends money, sends something, or deletes data.
- [ ] The same step failed twice — report, don't keep retrying.

## Extraction

- Pull structured data (rows, fields), not a flattened text blob.
- Record the source URL and time alongside extracted values.
- Note pagination; don't assume page 1 is the whole result set.
