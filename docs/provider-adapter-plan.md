---
summary: "Architecture and implementation plan for the multi-provider LLM adapter system"
read_when:
  - You are designing the provider layer for OpenAidy
  - You want a vendor-neutral runtime for OpenAI-compatible, Anthropic, and Gemini
  - You need implementation guidance that follows SOLID and clean architecture
title: "OpenAidy Provider Adapter Plan"
---

# OpenAidy Provider Adapter Plan

This document defines the recommended architecture and implementation plan for OpenAidy's multi-provider LLM integration system.

The goal is to support:

- OpenAI
- OpenAI-compatible providers
- Anthropic
- Google Gemini

without coupling the core platform to any single vendor SDK or agent framework.

## Goals

- Keep the provider layer vendor-neutral at the core.
- Support multiple providers through stable internal contracts.
- Make it easy to add new providers without changing dispatch logic.
- Preserve a plugin-first, extensible architecture.
- Support both streaming and non-streaming model execution.
- Keep provider configuration, secrets, and invocation concerns separate.

## Non-goals

- Building the full agent loop before the provider contracts are stable.
- Making one provider framework the center of the architecture.
- Exposing vendor SDK types outside infrastructure modules.
- Hardcoding provider-specific logic into session or dispatch flows.

## Architectural recommendation

Use a small provider-agnostic runtime contract and implement vendor-specific adapters behind it.

Recommended strategy:

- define the core runtime interfaces in `packages/runtime`
- define provider configuration schemas in `packages/config`
- implement provider registry and orchestration services in `apps/server`
- implement one adapter per provider family in isolated infrastructure modules

Recommended initial adapters:

- `openai-compatible`
- `anthropic`
- `gemini`

## Why not use `openai-agents-js` as the core

`openai-agents-js` can be useful later for specific OpenAI-centric agent workflows, but it should not be the foundation of the provider layer.

Reasons:

- OpenAidy needs a true multi-provider architecture.
- Anthropic and Gemini have different request, response, and streaming models.
- The core needs stable internal contracts independent of one vendor framework.
- Dispatch, sessions, and plugins should depend on internal abstractions, not on one framework's runtime model.

## Design principles

### SOLID

#### Single Responsibility Principle

Separate concerns into focused units:

- request normalization
- provider configuration resolution
- provider selection
- vendor invocation
- response mapping
- stream mapping
- secret resolution

#### Open/Closed Principle

The system should be open to new provider adapters without requiring core dispatch rewrites.

#### Liskov Substitution Principle

Every provider adapter must satisfy the same runtime contract so the application layer can swap them safely.

#### Interface Segregation Principle

Keep provider interfaces small and focused. Do not force all providers to implement unsupported features.

#### Dependency Inversion Principle

Application services depend on provider abstractions. Infrastructure modules depend on vendor SDKs.

## Clean architecture boundaries

Dependencies should point inward.

### Domain layer

Location:

- `packages/runtime`

Contains:

- provider interfaces
- request and response contracts
- stream event contracts
- model and capability descriptors
- domain errors and invariants

Does not contain:

- vendor SDKs
- direct HTTP clients
- environment variable reads

### Application layer

Location:

- `apps/server/src/providers/application`
- `apps/server/src/dispatch`

Contains:

- provider registry service
- provider selection service
- model invocation service
- secret resolution orchestration
- application-level validation and routing

Depends on:

- domain contracts

### Infrastructure layer

Location:

- `apps/server/src/providers/infrastructure/openai-compatible`
- `apps/server/src/providers/infrastructure/anthropic`
- `apps/server/src/providers/infrastructure/gemini`

Contains:

- adapter implementations
- vendor request mappers
- vendor response mappers
- stream parsers
- SDK or client factories

### Interface layer

Location:

- API routes in `apps/server/src/routes`
- future provider admin UI in `apps/web`

Contains:

- HTTP request handling
- Zod validation
- API response serialization

## Proposed folder structure

```text
packages/runtime/
  src/
    index.ts
    provider/
      model-provider.ts
      provider-registry.ts
      provider-capabilities.ts
      model-descriptor.ts
    messages/
      model-message.ts
      model-request.ts
      model-response.ts
      model-stream-event.ts
    tools/
      tool-definition.ts
      tool-call.ts
    errors/
      provider-error.ts
      provider-error-code.ts

packages/config/
  src/
    providers/
      provider-config.ts
      openai-compatible-config.ts
      anthropic-config.ts
      gemini-config.ts

apps/server/
  src/
    providers/
      application/
        provider-registry-service.ts
        provider-selection-service.ts
        model-invocation-service.ts
      infrastructure/
        openai-compatible/
          openai-compatible-adapter.ts
          openai-compatible-client.ts
          openai-compatible-mapper.ts
        anthropic/
          anthropic-adapter.ts
          anthropic-client.ts
          anthropic-mapper.ts
        gemini/
          gemini-adapter.ts
          gemini-client.ts
          gemini-mapper.ts
      routes/
        providers.ts
```

## Core contracts to define first

### `ModelProvider`

This is the main abstraction implemented by every provider adapter.

Responsibilities:

- expose provider metadata
- declare capabilities
- execute non-streaming generation
- execute streaming generation

Suggested responsibilities for the interface:

- `getDescriptor()`
- `supports(capability)`
- `generate(request)`
- `stream(request)`

Optional later:

- `listModels()`
- `healthCheck()`

### `ProviderDescriptor`

Contains metadata about a provider family.

Suggested fields:

- provider id
- display name
- adapter type
- supported capabilities
- configuration metadata

### `ModelDescriptor`

Contains metadata for one model.

Suggested fields:

- provider id
- model id
- display name
- capabilities
- token limits if known

### `ModelRequest`

Normalized request shape used by the application layer.

Suggested fields:

- `providerId`
- `model`
- `messages`
- `systemInstruction`
- `temperature`
- `maxTokens`
- `tools`
- `responseFormat`
- `stream`
- `metadata`

### `ModelResponse`

Normalized output from all providers.

Suggested fields:

- `providerId`
- `model`
- `text`
- `toolCalls`
- `finishReason`
- `usage`
- `rawMetadata`

### `ModelStreamEvent`

Normalized streaming contract.

Suggested event types:

- `response.started`
- `response.delta`
- `tool.call.delta`
- `tool.call.completed`
- `response.completed`
- `response.error`

## Capability model

Each provider should declare what it supports.

Suggested capabilities:

- `text_generation`
- `streaming`
- `tool_calling`
- `json_mode`
- `multimodal_input`
- `vision`
- `embeddings`
- `audio_input`
- `audio_output`

The application layer should validate capability usage before invocation.

## Provider configuration model

Separate persisted provider configuration from runtime invocation.

Suggested common config fields:

- provider id
- adapter type
- enabled flag
- default model
- timeout
- retry policy
- secret reference

### OpenAI-compatible config

Suggested fields:

- `adapterType: openai-compatible`
- `baseUrl`
- `apiKey`
- `defaultModel`
- optional headers

This should cover:

- OpenAI
- OpenRouter
- Together
- Groq
- LiteLLM or vLLM gateways
- self-hosted OpenAI-compatible endpoints

### Anthropic config

Suggested fields:

- `adapterType: anthropic`
- `apiKey`
- `defaultModel`

### Gemini config

Suggested fields:

- `adapterType: gemini`
- `apiKey`
- `defaultModel`

## Secrets handling

Do not let adapters read environment variables directly.

Recommended approach:

- configuration stores secret references
- a secret resolution service fetches the real secret
- the application layer passes validated config into adapters

This improves testability and allows future secret backends.

## Provider registry design

### `ProviderRegistryService`

Responsibilities:

- register provider adapters
- resolve provider by id
- list available providers
- expose provider descriptors
- support enabled and disabled state

### `ProviderSelectionService`

Responsibilities:

- select the requested provider
- apply configured defaults
- validate provider and model compatibility
- prepare for future failover or routing policies

## Invocation flow

Recommended request flow:

1. API route receives a model invocation request.
2. Route validates the request with Zod.
3. Application service resolves provider configuration.
4. Selection service chooses the provider adapter.
5. Invocation service builds a normalized request.
6. Adapter maps the request into the vendor payload.
7. Adapter executes the SDK or HTTP request.
8. Adapter maps the vendor response into normalized output.
9. Application layer emits logs and events.
10. Route returns normalized output.

## Error handling

Create a normalized provider error type.

Suggested fields:

- `code`
- `providerId`
- `model`
- `retryable`
- `message`
- `cause`
- `metadata`

Suggested error codes:

- `provider_not_found`
- `provider_disabled`
- `model_not_supported`
- `authentication_failed`
- `rate_limited`
- `timeout`
- `upstream_error`
- `invalid_request`
- `stream_parse_error`

## OpenAI-compatible first

The first adapter to implement should be `openai-compatible`.

Reasons:

- it provides the highest leverage first
- it supports OpenAI itself
- it supports many compatible providers through one protocol family
- it allows local and self-hosted endpoints later

Recommended product distinction:

- keep `openai-compatible` as the technical adapter type
- allow product-facing provider entries like `OpenAI` or `Groq` to use that adapter underneath

## Implementation phases

### Phase 1: contracts and configuration

Deliverables:

- provider interfaces
- model request and response contracts
- stream event contracts
- provider config schemas
- provider error model

### Phase 2: registry and invocation services

Deliverables:

- provider registry service
- provider selection service
- model invocation service
- secret resolution interface

### Phase 3: OpenAI-compatible adapter

Deliverables:

- OpenAI-compatible adapter implementation
- request and response mapping
- streaming support
- error normalization
- one route for test invocation

### Phase 4: Anthropic adapter

Deliverables:

- Anthropic adapter implementation
- request and response mapping
- streaming support
- capability declarations

### Phase 5: Gemini adapter

Deliverables:

- Gemini adapter implementation
- request and response mapping
- streaming support
- capability declarations

### Phase 6: provider management API and UI

Deliverables:

- provider list route
- provider config route
- provider health-check route
- future provider configuration UI

## Testing strategy

### Unit tests

For each adapter:

- request mapping
- response mapping
- stream mapping
- error normalization

### Contract tests

Create a shared test suite that every provider adapter must pass.

Examples:

- generate text
- stream text
- reject unsupported capabilities correctly
- reject invalid config correctly

### Integration tests

Use mock or sandbox environments where practical.

Focus on:

- OpenAI-compatible
- Anthropic
- Gemini

## Rules to preserve scalability

- Do not branch on vendor names inside dispatch logic.
- Do not leak vendor SDK types outside infrastructure modules.
- Do not let adapters parse raw HTTP requests.
- Do not mix secret loading into vendor adapters.
- Do not build one giant adapter with vendor conditionals.

## Recommended first milestone

The first provider milestone should be considered complete when:

- runtime contracts are defined
- provider registry exists
- one `openai-compatible` adapter works
- it can call OpenAI with a configured API key
- it can call another OpenAI-compatible endpoint with a custom `baseUrl`
- streaming and non-streaming paths both work
- normalized errors and usage are returned

## Recommended immediate next steps

Implement in this order:

1. define contracts in `packages/runtime`
2. define provider config schemas in `packages/config`
3. implement registry and invocation services in `apps/server`
4. implement `openai-compatible` first
5. add one test route for invocation
6. add Anthropic and Gemini after the first adapter is stable

## Expected outcome

After this plan is implemented, OpenAidy should have:

- a stable internal provider abstraction
- clean support for multiple vendor families
- a scalable path for future providers
- a core runtime independent from any one vendor framework
