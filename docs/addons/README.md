---
summary: 'What an addon is, and the create/install/validate workflow'
read_when:
  - You want to build or install a mini-app that plugs into OpenAidy
title: 'Addons'
---

# Addons

An addon is a small web app that runs inside OpenAidy — its own screen in the sidebar, its own UI, with permission-gated access to a subset of the platform (agents, sessions, tasks, pulses, channels, its own private storage). It's the difference between asking an agent a question and getting a text answer, versus getting a persistent tool with its own interface that stays installed.

Addons run in a sandboxed iframe with no direct access to your session or credentials — every capability they use goes through the OpenAidy SDK and is explicitly granted per-permission. See [Addon Permissions](./addon-permissions.md) for the full reference of what an addon can request and what each permission actually unlocks.

## Creating an addon

```bash
openaidy addon create my-addon
openaidy addon create my-addon --template <template-name>
openaidy addon templates    # list available templates
```

This scaffolds a new addon directory with an `addon.json` manifest (id, permissions, entry point) and a starter `index.html`/`index.js` that already loads the OpenAidy SDK.

An agent can also generate an addon for you conversationally — ask it to build you a tool for whatever you need, and it writes the manifest, HTML, and JS directly.

## Validating an addon

```bash
openaidy addon validate                 # check the addon in the current directory
openaidy addon validate --verbose
openaidy addon validate --strict        # fail on warnings, not just errors
```

Validation checks the manifest against the schema (permission format, resource names, storage config) and scans the addon's code for common issues — for example, `fetch()` calls to hosts that aren't declared in `externalDomains`, which the browser will block via CSP at runtime otherwise.

## Installing an addon

```bash
openaidy addon install my-addon
openaidy addon install my-addon --server-url http://localhost:3001 --token <token>
```

Installing copies the addon into your OpenAidy instance and registers it. It then needs to be **enabled** — from the Addons page in the web UI — where you review and approve the permissions it requested before it can actually call anything.

## What's not implemented yet

The CLI's help output lists a few addon subcommands (`addon init`, `addon build`, `addon dev`, `addon publish`) that aren't wired up yet — running them returns an unknown-command error today. Use `addon create` for scaffolding in the meantime.

## The SDK, from inside an addon

```html
<script src="/sdk/openaidy-sdk.js"></script>
<script>
  OpenAidy.ready(async (sdk) => {
    const { items } = await sdk.tasks.list();
  });
</script>
```

Every method call is checked against the addon's granted permissions server-side — see [Addon Permissions](./addon-permissions.md) for the complete method-by-method reference, including `sessions.*`, `agents.*`, `tasks.*`, `pulses.*`, `channels.*` (read-only), and `storage.*` (a private SQLite database per addon).
