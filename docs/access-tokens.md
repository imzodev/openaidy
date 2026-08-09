---
summary: 'Access tokens for logging in and authenticating the API, and approving new devices'
read_when:
  - You need to create a scoped credential for the API or CI
  - A new device is trying to connect and needs approval
title: 'Access Tokens & Device Pairing'
---

# Access Tokens & Device Pairing

## Access tokens

An access token authenticates a client against the OpenAidy API — logging into the web UI, a CI pipeline calling the API, or any other automated client. Each token has a name and a set of scopes.

```bash
openaidy tokens create --name "My Token" --scopes "*"                        # full access
openaidy tokens create --name "CI Pipeline" --scopes "sessions.read,sessions.stream"  # scoped
openaidy tokens list
openaidy tokens revoke <id>
```

The raw token is only ever shown once, at creation. If you lose it, revoke it and create a new one — there's no way to retrieve it again.

### The bootstrap admin token

On first run, OpenAidy generates one special, full-access **bootstrap admin token** so you have a way in before you've created anything else. It's meant for initial setup — `openaidy init` regenerates it if it's lost or expired, and `openaidy admin token show/validate/path` let you inspect it. Create a normal scoped access token for everyday use once you're logged in.

## Device pairing

Instead of copy-pasting a token, a new device (a phone, another browser) can send a pairing request, which you approve or deny from wherever you're already logged in.

```bash
openaidy devices list                     # pending requests
openaidy devices list --status all        # every request, any status
openaidy devices approve <request-id>
openaidy devices approve <request-id> --scopes chat,files    # custom scopes
openaidy devices deny <request-id>
```

Approving issues that device its own scoped access token behind the scenes — you're not sharing a credential, each device gets its own.

## Related

- The full CLI walkthrough with expected output for every command above lives in the [CLI Getting Started guide](./cli/getting-started.md)
