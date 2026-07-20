---
name: Addon UI Components Cookbook
description: Use when writing or reviewing OpenAidy addon UI code (app/index.html, app/index.js) that calls sdk.ui.* — covers component mounting semantics and composed usage patterns beyond the one-line reference in addon_create's tool description.
version: 1.0.0
---

# Addon UI Components Cookbook

`sdk.ui.*` is a 25-component Tailwind-styled vanilla-JS library available to
every addon. The `addon_create` tool description already lists every
component's signature and a one-line example — this skill does not repeat
that. It exists for the one thing the flat reference can't show: how
components mount, and how they compose into real UIs.

## The rule that actually causes bugs: mounting semantics differ

Every `sdk.ui.*` call returns an `HTMLElement`, but **what you do with that
return value depends on the component**:

- **Self-mounting** — `sdk.ui.dialog(...)` and `sdk.ui.sheet(...)` append
  themselves to `document.body` the moment you call them. They are already
  on the page. **Do not `appendChild` their return value anywhere** — doing
  so re-parents the live modal/panel out of `document.body` and can break
  its backdrop/focus-trap positioning. Just call them; the dialog/sheet
  appears. Keep the return value only if you need to close it
  programmatically later (`dialog.remove()` or rely on its own close
  affordances).
- **Manual-mount (everything else)** — `card`, `button`, `input`, `select`,
  `table`, `tabs`, `dropdownMenu`, `popover`, `toast`, etc. build a detached
  `HTMLElement` and do nothing until you append it:
  `container.appendChild(sdk.ui.button({ text: 'Save' }))`. Forgetting this
  is the single most common mistake — the component "does nothing" because
  it was never attached to the DOM.
- `toast` is a special case of manual-mount: it _looks_ self-mounting
  (nothing to append) because it queues itself into an internal stacked
  container, but that container is lazily created on first call — you
  still just call `sdk.ui.toast({...})` with no assignment, same as
  `dialog`.

When in doubt: if the component's job is to float above the whole page
(modal, slide-in panel), it self-mounts. If its job is to sit inside your
layout (form controls, cards, tables, menus), you mount it.

## Composed recipes

### 1. A settings panel inside a card

```js
var root = document.getElementById('root'); // or document.body

var settingsCard = sdk.ui.card({
  title: 'Preferences',
  children: [
    sdk.ui.switch({
      label: 'Email notifications',
      checked: true,
      onChange: function (v) {
        /* ... */
      },
    }),
    sdk.ui.select({
      label: 'Theme',
      options: [
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ],
      onChange: function (v) {
        /* ... */
      },
    }),
  ],
});

root.appendChild(settingsCard);
```

`card`'s `children` accepts an array of elements — build the controls first,
then hand them to `card` in one call rather than appending each separately.

### 2. Form + validation + toast (no dialog)

```js
var nameInput = sdk.ui.input({ label: 'Name', placeholder: 'Ada Lovelace' });
var saveBtn = sdk.ui.button({
  text: 'Save',
  onClick: function () {
    var value = nameInput.querySelector('input').value;
    if (!value) {
      sdk.ui.toast({ message: 'Name is required', type: 'error' });
      return;
    }
    sdk.ui.toast({ message: 'Saved!', type: 'success' });
  },
});

document
  .getElementById('root')
  .appendChild(
    sdk.ui.card({ title: 'New contact', children: [nameInput, saveBtn] }),
  );
```

`input`/`textarea`/`select` return a wrapper `<div>` (label + control), not
the bare `<input>` — read the value via `.querySelector('input'|'select'|'textarea')`,
or capture it from the `onChange` callback instead of querying the DOM.

### 3. Dialog with a form (self-mounting + manual-mount together)

```js
function openEditDialog(row) {
  var titleInput = sdk.ui.input({ label: 'Title', value: row.title });

  sdk.ui.dialog({
    title: 'Edit item',
    content: titleInput, // manual-mount component passed as content — fine, dialog appends it internally
    buttons: [
      { text: 'Cancel', variant: 'secondary' },
      {
        text: 'Save',
        variant: 'primary',
        onClick: function () {
          var value = titleInput.querySelector('input').value;
          sdk.ui.toast({ message: 'Updated', type: 'success' });
        },
      },
    ],
  });
  // No appendChild here — dialog() already put itself in document.body.
}
```

`buttons` is a plain array of `{ text, variant, onClick }` descriptors —
`dialog` builds the actual `sdk.ui.button` elements for you. Don't pass
pre-built button elements in `buttons`; that param is data, not children.

### 4. Table row click → detail sheet

```js
var table = sdk.ui.table({
  columns: [
    { key: 'name', label: 'Name' },
    { key: 'status', label: 'Status' },
  ],
  rows: items, // array of { name, status }
  onRowClick: function (row) {
    sdk.ui.sheet({
      title: row.name,
      children: sdk.ui.badge({
        text: row.status,
        color: row.status === 'active' ? 'green' : 'gray',
      }),
    });
    // sheet() self-mounts — nothing to append here either.
  },
});

document.getElementById('root').appendChild(table);
```

### 5. Actions menu (dropdownMenu is manual-mount, unlike dialog/sheet)

```js
var menu = sdk.ui.dropdownMenu({
  trigger: 'Actions',
  items: [
    {
      label: 'Rename',
      onClick: function () {
        /* ... */
      },
    },
    {
      label: 'Delete',
      onClick: function () {
        /* ... */
      },
    },
  ],
});

document.getElementById('root').appendChild(menu); // dropdownMenu builds a closed menu — you still mount it
```

## Prefer `sdk.ui.card` over hand-rolled repeated blocks

If your addon renders a list/grid of items (phrase cards, contact rows,
notification tiles — anything built in a `.map()`/`.forEach()` loop), wrap
each item in `sdk.ui.card` instead of hand-rolling
`document.createElement('div')` + Tailwind border/shadow/padding classes for
it. This applies even when the item has no title — `title`/`subtitle` are
optional, and `card` works fine with only `children`:

```js
// Don't: hand-rolled container for a repeated item
var el = document.createElement('div');
el.className = 'bg-white rounded-lg p-4 shadow-sm border-2 border-slate-200';
el.appendChild(ltEl);
el.appendChild(pronEl);
el.appendChild(btn);

// Do: same content, sdk.ui.card owns the container styling
var el = sdk.ui.card({ children: [ltEl, pronEl, btn] });
```

A recurring pattern in generated addons: `sdk.ui.card` gets used once for a
page header, then every item inside a loop reverts to a raw `<div>` — as if
`card` were a one-per-page component rather than a general container. It
isn't; use it anywhere a bordered/padded box is needed, including inside a
loop. Reach for a hand-rolled `<div>` only when the block needs something
`card`/`table`/`accordion` genuinely can't express (a custom progress-bar
fill, a flip-animated flashcard face) — not merely because it repeats.

## Common mistakes to avoid

- `document.body.appendChild(sdk.ui.dialog({...}))` — wrong; `dialog` is
  already in the DOM, this just moves it (harmless-looking but fragile;
  don't rely on it).
- Building `sdk.ui.button(...)` elements and passing them into `dialog`'s
  or `dropdownMenu`'s `items`/`buttons` arrays — those params take plain
  `{ text, onClick }` descriptor objects, not `HTMLElement`s.
- Forgetting to mount `input`/`select`/`textarea`/`table`/`card`/etc. at
  all — every one of these is inert until appended somewhere.
- Reading a form value with `input.value` instead of
  `input.querySelector('input').value` — the top-level return is the
  label+control wrapper, not the control itself.
