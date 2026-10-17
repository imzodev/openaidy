---
summary: 'Connect external MCP servers, preinstalled servers, secrets, and the CLI import/migrate commands'
read_when:
  - You want to give agents access to external tools via MCP
title: 'MCP Servers'
---

# MCP Servers

OpenAidy connects to external [MCP](https://modelcontextprotocol.io) servers via stdio or HTTP transport, giving agents access to whatever tools those servers expose. Configure servers through **Settings → MCP** in the web UI, or the REST API at `POST /api/mcp/servers`.

## Preinstalled servers

These ship preinstalled — reconciled into every install on startup:

| Server              | Transport | Auth                              | Notes                                                                       |
| ------------------- | --------- | --------------------------------- | --------------------------------------------------------------------------- |
| GitHub              | http      | `${GITHUB_PERSONAL_ACCESS_TOKEN}` | PAT with `repo` + `read:user` scopes                                        |
| Sequential Thinking | stdio     | none                              | Step-by-step reasoning                                                      |
| Time                | stdio     | none                              | Time + timezone conversion                                                  |
| Playwright Browser  | stdio     | none                              | Microsoft-maintained browser automation                                     |
| Context7 Docs       | http      | optional                          | Free tier works without a key; `${CONTEXT7_API_KEY}` for higher rate limits |
| Brave Search        | stdio     | `${BRAVE_API_KEY}`                | Free tier (~2000 req/month)                                                 |
| Tavily Search       | stdio     | `${TAVILY_API_KEY}`               | Free tier                                                                   |
| Buffer              | http      | `${BUFFER_API_KEY}`               | Social media scheduling, per-account key                                    |

A server whose secret is unset sits in "Awaiting configuration" instead of trying (and failing) to connect.

## Setting API keys

A server that needs a secret references it as `${VAR_NAME}` in its `headers` (http transport) or `env` (stdio transport). On the MCP page, a server missing one shows an **Awaiting configuration** banner with a plain "paste your API key" field for each `${VAR_NAME}` it needs — paste the key and save. OpenAidy encrypts it at rest (AES-256-GCM) and resolves it into the placeholder at connection time; the server's own `env`/`headers` config is never edited, so there's nothing to break and future updates to a preinstalled server's definition still apply.

For self-hosted/ops deployments that want a secret out of the config file entirely, set the real environment variable before starting the server instead — it takes priority over a pasted key if both are set:

```bash
export GITHUB_PERSONAL_ACCESS_TOKEN=ghp_…
openaidy start
```

## Adding your own server

Add an entry via the UI or the API, specifying:

- `id`, optional `name`
- `transport`: `stdio` or `http`
- For `stdio`: `command`, `args`, optional `env`
- For `http`: `url`, optional `headers`

## Migrating secrets to encrypted storage

If you have older MCP server entries with plaintext inline secrets, encrypt them at rest:

```bash
openaidy mcp migrate-secrets --dry-run   # preview what would change
openaidy mcp migrate-secrets             # actually re-encrypt
```

## Importing servers in bulk

```bash
openaidy mcp import servers.json     # from a file
cat servers.json | openaidy mcp import   # from stdin
```

## Example: Parallel web search and page fetching

[Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp) provides `web_search` for current web information and `web_fetch` for reading specific URLs. The anonymous endpoint is free to use without an account or API key; search uses Fast mode. Anonymous requests have lower rate limits, so this setup suits exploration and light use.

Save the following as `parallel-mcp.json`:

```json
{
  "mcpServers": {
    "parallel-search": {
      "name": "Parallel Search",
      "type": "http",
      "url": "https://search.parallel.ai/mcp",
      "headers": {
        "User-Agent": "OpenAidy"
      }
    }
  }
}
```

With your OpenAidy server running and your CLI authenticated, import it:

```bash
openaidy mcp import parallel-mcp.json
```

You can also paste the same JSON into **MCP Servers → Import** in the web UI. OpenAidy connects the imported server and discovers its tools. Check that **Parallel Search** is connected, then open **Agents**, select your agent, and enable **Parallel Search** in its **MCP Servers** tab. Importing a server does not enable it for every agent.

In a chat with that agent, try: "Use Parallel to find the current Node.js LTS release on nodejs.org, fetch the release page, and summarize the support dates with source URLs." The tools work together: `web_search` finds candidate pages, and `web_fetch` reads the selected URLs. Use a model that supports tool calling.

This adds an optional server alongside your existing MCP servers. To stop using it, disable it for the agent or remove the server from **MCP Servers**.

## Related

- [Addons](./addons/README.md) — an addon's own permission for MCP access is granted indirectly through whatever agent it's allowed to invoke, not declared directly
