# Control Plane Documentation Plan

# OpenAidy CLI Implementation and Documentation Plan

This plan defines the full work required to deliver the first production-worthy OpenAidy CLI, keep the command UX stable as `openaidy ...`, and document the feature set properly as part of the rollout. It covers implementation, package structure, shared services, testing, operator experience, and the documentation set that must ship with it.

## Scope

This plan covers:

- a repo-local CLI that exposes the final command shape
- the shared application/service layer behind privileged CLI workflows
- integration with the existing bootstrap-admin token manager
- local administration of device pairing requests
- a documentation set that explains both usage and architecture
- a clean path from repo-local usage to future global installation

This plan does not cover:

- remote administration over HTTP or WebSocket
- a web-based admin UI
- standalone binaries
- broad command expansion beyond the first admin and device workflows

## Goals

- keep the operator-facing command UX stable as `openaidy ...`
- avoid duplicating server-side business logic in the CLI
- reuse the bootstrap-admin token state that already exists on disk
- make local privileged workflows reliable even when the server is not running
- establish strong foundations for future JSON output, published distribution, and remote admin surfaces
- ship documentation that is aligned with the actual implementation

## Desired user experience

### Near-term

Inside the repo, a developer or operator should be able to run:

- `pnpm openaidy admin token show`
- `pnpm openaidy devices list`
- `pnpm openaidy devices approve <requestId>`
- `pnpm openaidy devices deny <requestId>`

### Long-term

After the CLI package is ready for distribution, the same UX should become:

- `openaidy admin token show`
- `openaidy devices list`
- `openaidy devices approve <requestId>`
- `openaidy devices deny <requestId>`

The command names, nesting, and semantics should not change between these phases.

## Architectural principles

### 1. Thin CLI, authoritative services

The CLI should only own:

- argument parsing
- help text
- output formatting
- exit codes
- input validation at the command boundary

The CLI should not own:

- bootstrap token generation
- credential persistence rules
- pairing approval business logic
- shared domain policy

### 2. Reuse the existing bootstrap-admin manager

The existing bootstrap-admin token manager remains the source of truth for:

- whether bootstrap admin is enabled
- where the token is stored
- what token record exists on disk
- token metadata and lifecycle state already supported by the server

The CLI should read or orchestrate this existing behavior, not recreate it.

### 3. Introduce a reusable control-plane application layer

Between the CLI and low-level services, add a shared application layer that exposes admin-oriented workflows in stable interfaces.

That layer should be reusable by:

- the local CLI
- future web/admin surfaces
- future remote APIs
- future automation-oriented entrypoints

### 4. Local-first administration

For the first implementation slice, privileged CLI commands should operate against local config and persistence rather than requiring a running server process. That keeps bootstrapping simple, reduces operational coupling, and matches the current bootstrap-admin storage model.

## Proposed package and code structure

## 1. New CLI workspace package

Create a dedicated workspace package under `packages/` for the CLI.

Recommended responsibilities:

- executable entrypoint
- command tree definition
- argument parsing
- terminal rendering
- exit code mapping
- command integration tests

Recommended package requirements:

- `package.json` with `bin` mapping for `openaidy`
- TypeScript entrypoint
- build script
- test script
- compatibility with repo-local execution through pnpm

## 2. Shared control-plane service layer

Create a shared package or internal module that owns operator workflows.

Recommended responsibilities:

- load environment/config required by admin operations
- load bootstrap-admin token state through existing authoritative code
- load pending pairing requests from persistence
- approve or deny pairing requests through shared business logic
- normalize domain results and failures for CLI consumption

Recommended interfaces:

- bootstrap token inspection service
- pairing request query service
- pairing decision service
- common error/result types

## 3. Clear dependency boundaries

Recommended dependency flow:

- CLI package depends on control-plane application layer
- control-plane application layer depends on server/domain modules or extracted shared modules
- persistence and token generation remain authoritative in existing server-side code paths

Avoid reversing this dependency direction.

## Initial command contract

These commands should be treated as the first stable contract.

## 1. `openaidy admin token show`

Purpose:

- show the current bootstrap-admin token information available to the local operator

Expected behavior:

- reads the persisted bootstrap-admin record
- fails clearly if bootstrap-admin is disabled
- fails clearly if the expected token file is missing or unreadable
- prints the token intentionally and only for this explicit command
- prints useful metadata if available, such as file path or expiration state

## 2. `openaidy devices list`

Purpose:

- list pending device pairing requests requiring administrative action

Expected behavior:

- reads pending requests from the source of truth used by the pairing flow
- shows request identifiers and enough context for an operator decision
- exits successfully with a clear empty state when no requests are pending

## 3. `openaidy devices approve <requestId>`

Purpose:

- approve a pending pairing request

Expected behavior:

- validates that the request exists and is still actionable
- performs the approval through shared application logic
- returns a clear success message and non-zero exit code on failure

## 4. `openaidy devices deny <requestId>`

Purpose:

- deny a pending pairing request

Expected behavior:

- validates that the request exists and is still actionable
- performs the denial through shared application logic
- returns a clear success message and non-zero exit code on failure

## Implementation phases

## Phase 1: Foundation and packaging

Deliver the CLI package and local execution path.

### Deliverables

- new workspace package for the CLI
- `openaidy` executable entrypoint
- TypeScript project configuration for the CLI package
- root-level repo wiring so `pnpm openaidy ...` works naturally
- baseline help output and command discovery

### Design decisions to lock in

- exact package location and naming
- command parser library or minimal custom parser choice
- build output format for Node execution
- root script alias strategy

## Phase 2: Shared admin workflow layer

Create the reusable application layer that sits behind the CLI.

### Deliverables

- bootstrap-admin inspection workflow
- pairing request query workflow
- pairing approval workflow
- pairing denial workflow
- normalized error categories and return shapes

### Requirements

- no duplicated bootstrap token generation logic
- clear separation between formatting and business behavior
- reusable method signatures that can later support JSON or remote APIs

## Phase 3: Implement the first commands

Wire the command handlers to the application layer.

### Deliverables

- `admin token show`
- `devices list`
- `devices approve <requestId>`
- `devices deny <requestId>`

### Operator UX requirements

- readable terminal output
- actionable error messages
- consistent exit codes
- predictable handling of missing config, missing files, and invalid request ids

## Phase 4: Test coverage and hardening

Add the required tests before expanding the command surface.

### Test layers

- unit tests for command parsing and argument validation
- unit tests for service-layer workflows
- integration tests for CLI-to-service wiring
- fixture-based tests for bootstrap token file handling
- fixture-based tests for pending pairing request handling

### Important scenarios

- bootstrap admin disabled
- bootstrap token file missing
- bootstrap token file malformed
- no pending devices
- request id not found
- request already acted on
- persistence failure during approve or deny

## Phase 5: Documentation rollout

Ship documentation as part of the implementation, not afterthought work.

### Required documentation deliverables

- control-plane overview
- bootstrap-admin operator guide
- CLI getting started guide
- command reference for initial commands
- contributor architecture guide
- installation and distribution notes
- troubleshooting and security notes

### Documentation objectives

- explain how the CLI works today in the repo
- explain how bootstrap-admin credentials must be handled safely
- explain the package boundaries for contributors
- explain how the command UX remains stable as distribution evolves

## Phase 6: Post-MVP expansion path

Define the next steps now so the first implementation does not block them later.

### Candidate follow-ups

- `--json` output mode
- confirmation prompts for mutating commands where appropriate
- `devices show <requestId>`
- `admin token path`
- `admin token status`
- token rotation or revocation workflows
- published package distribution
- remote administration surface reuse of the same application layer

## Detailed implementation work breakdown

## 1. Repository and package wiring

- create the CLI workspace package under `packages/`
- ensure it is included by the existing pnpm workspace rules
- add package scripts for build, dev, and test
- add root script wiring for repo-local execution
- confirm executable resolution works the same in CI and locally

## 2. CLI entrypoint and command registry

- create a single entrypoint for the `openaidy` binary
- define top-level command groups: `admin` and `devices`
- define nested command groups such as `admin token`
- implement help output for the root command and each subgroup
- map command failures to process exit codes centrally

## 3. Bootstrap-admin command support

- identify the minimal reusable API needed from bootstrap-admin logic
- expose a safe read path for the persisted bootstrap-admin record
- implement display formatting for explicit token inspection
- include metadata useful for operators without overexposing secrets in unrelated commands

## 4. Device pairing admin support

- identify the source of pending pairing requests
- expose application-layer methods for listing, approving, and denying requests
- ensure the CLI can distinguish not-found from already-processed states
- define stable output text for success and failure outcomes

## 5. Error model

Define explicit categories that the CLI can render consistently.

Recommended categories:

- configuration error
- bootstrap disabled
- credentials missing
- credentials malformed
- request not found
- request not actionable
- persistence error
- unexpected internal error

Each category should map to:

- a human-readable message
- an exit code policy
- a future machine-readable representation

## 6. Output model

Human-readable output is enough for the first slice, but the implementation should be structured so JSON output can be added later without rewriting command handlers.

Recommended rules:

- keep command handlers free of direct domain logic
- centralize rendering of tabular/list output where practical
- keep success messages short and specific
- never print sensitive token values except in explicit token-display commands

## 7. Security and operational rules

The CLI is a privileged administration surface and should be designed accordingly.

### Rules

- treat `.openaidy/credentials/bootstrap-admin.json` as sensitive operator state
- never regenerate bootstrap credentials from the CLI unless a future rotation workflow explicitly allows it
- avoid logging token values in tests, errors, or normal command output
- keep mutation commands explicit and easy to audit
- document local-first trust assumptions clearly

## Documentation plan within this implementation

The CLI implementation should ship with a documentation set that matches the real system behavior.

## 1. Control-plane overview document

Audience:

- contributors
- operators
- future CLI and admin-surface developers

Topics:

- what the control plane is
- how the CLI fits with the server and WebSocket gateway
- why bootstrap-admin exists
- which parts are local-first today
- what is intentionally out of scope for the first release

## 2. Bootstrap-admin operator guide

Topics:

- where the token is generated and stored
- how to inspect it safely
- what it authorizes
- what risks it carries
- what future rotation and revocation may look like

## 3. CLI getting started guide

Topics:

- where the CLI lives in the monorepo
- how to run it with pnpm
- the initial command set
- expected examples
- troubleshooting for missing config or credentials

## 4. Command reference

Use a per-command template with:

- purpose
- usage
- arguments
- options
- examples
- expected output
- exit behavior
- failure cases
- required privilege level

## 5. Contributor architecture guide

Topics:

- package boundaries
- control-plane application layer responsibilities
- server-side authoritative services
- rules for adding new commands
- how to avoid duplicating business logic

## 6. Installation and distribution guide

Document both phases:

- repo-local execution with `pnpm openaidy ...` and `pnpm exec openaidy ...`
- future published/global install with unchanged command UX

## Recommended implementation order

1. Create the CLI package and repo-local executable path.
2. Add the shared control-plane application layer.
3. Implement `openaidy admin token show`.
4. Implement `openaidy devices list`.
5. Implement `openaidy devices approve <requestId>` and `openaidy devices deny <requestId>`.
6. Add error handling and output conventions.
7. Add tests across command and service layers.
8. Write the usage and architecture documentation against the implemented behavior.
9. Prepare the package for future global installation without changing the CLI contract.

## Agent task breakdown

The following tasks are written for an AI programming agent. Each task should produce clean, scalable, production-quality code. The agent should prefer best practices, strong separation of concerns, explicit error handling, and reusable abstractions over quick one-off implementations.

### Cross-task quality rules

- reuse authoritative code instead of copying business logic
- keep CLI parsing, application workflows, and output rendering separate
- prefer small focused modules over large monolithic command files
- preserve the agreed command UX exactly
- add tests for every new behavior and failure mode
- keep the implementation extensible for future `--json` output and global installation
- avoid introducing hidden coupling to a running server process for local admin commands unless absolutely required

### Task 1: Create the CLI workspace package

#### Result expected

Create a new workspace package that exposes the `openaidy` binary and can be invoked locally from the monorepo. The result should be the minimal but real foundation for all later CLI work.

#### Likely files to create or modify

- `package.json`
- `pnpm-workspace.yaml` if workspace discovery needs adjustment
- `packages/cli/package.json` or equivalent final CLI package path
- `packages/cli/src/index.ts`
- CLI package TypeScript configuration if needed
- CLI package test files

#### Current code to inspect or reuse

- `/home/irving/webdev/openaidy/package.json`
- `/home/irving/webdev/openaidy/pnpm-workspace.yaml`
- `/home/irving/webdev/openaidy/apps/server/package.json`

#### Guidance for the agent

- expose the executable through `package.json#bin` as `openaidy`
- follow existing monorepo script and tooling conventions
- keep the entrypoint minimal and avoid placing business logic directly in it
- ensure the local execution model can evolve into published/global install without command renames

#### Tests expected

- a smoke test proving the CLI binary starts successfully
- a no-args or help-output behavior test
- validation that repo-local invocation works through pnpm scripts

### Task 2: Implement the command registry and help system

#### Result expected

Define the CLI command tree with top-level command groups and subcommands. The result should provide deterministic parsing, useful help output, and centralized exit behavior.

#### Likely files to create or modify

- `packages/cli/src/index.ts`
- `packages/cli/src/commands/*`
- `packages/cli/src/lib/*`
- CLI test files

#### Current code to inspect or reuse

- the command contract in this plan
- the agreed command groups `admin` and `devices`

#### Guidance for the agent

- define top-level groups `admin` and `devices`
- define nested commands such as `admin token show`
- centralize help text generation and error-to-exit behavior
- avoid calling `process.exit` deep in handlers
- structure the command layer so machine-readable output can be added later

#### Tests expected

- root help output test
- subgroup help output test
- unknown-command error test
- missing-argument error test
- exit-code behavior test for parsing failures

### Task 3: Introduce a shared control-plane application layer

#### Result expected

Create a reusable application/service layer that owns admin workflows and sits between the CLI and existing low-level modules. The result should make CLI handlers thin and future surfaces reusable.

#### Likely files to create or modify

- new shared package or internal module for control-plane workflows
- service files for bootstrap token inspection and pairing administration
- shared result and error types
- CLI handlers updated to depend on this layer

#### Current code to inspect or reuse

- `/home/irving/webdev/openaidy/apps/server/src/bootstrap-admin.ts`
- `/home/irving/webdev/openaidy/apps/server/src/app.ts`
- `/home/irving/webdev/openaidy/apps/server/src/lib/env.ts`
- `/home/irving/webdev/openaidy/apps/server/src/websocket/pairing-service.ts`

#### Guidance for the agent

- do not perform a large risky extraction unless it is necessary
- introduce narrow reusable seams instead of broad rewrites
- keep terminal formatting out of the shared workflow layer
- define service methods around operator workflows, not low-level storage operations

#### Tests expected

- unit tests for the shared workflow layer
- tests for normalized result and error behavior
- tests proving CLI handlers can consume this layer without depending on internals

### Task 4: Implement the bootstrap-admin inspection workflow

#### Result expected

Provide the reusable logic needed to support `openaidy admin token show`. The result should inspect existing bootstrap-admin state safely without regenerating credentials during a read-only command.

#### Likely files to create or modify

- shared workflow module for bootstrap token inspection
- `/home/irving/webdev/openaidy/apps/server/src/bootstrap-admin.ts` if a read-oriented API is needed
- CLI handler for `admin token show`
- related tests

#### Current code to inspect or reuse

- `/home/irving/webdev/openaidy/apps/server/src/bootstrap-admin.ts`
- `/home/irving/webdev/openaidy/apps/server/src/bootstrap-admin.test.ts`
- `/home/irving/webdev/openaidy/apps/server/src/lib/env.ts`
- `/home/irving/webdev/openaidy/apps/server/src/app.ts`

#### Guidance for the agent

- reuse `BootstrapAdminManager` as the authoritative source wherever practical
- be careful not to conflate `ensureToken()` with a pure inspection workflow
- if a new read-only method is needed, keep it explicit and side-effect free
- distinguish disabled bootstrap-admin, missing token file, malformed token file, and invalid token state clearly
- never print token values except in the explicit display command

#### Tests expected

- valid bootstrap token inspection
- bootstrap-admin disabled behavior
- missing token file behavior
- malformed token file behavior
- invalid persisted token behavior
- command-level test for `openaidy admin token show`

### Task 5: Implement pending pairing request listing

#### Result expected

Provide the reusable workflow and CLI handler for `openaidy devices list`. The result should expose pending pairing requests in an operator-friendly shape without leaking persistence details into the CLI layer.

#### Likely files to create or modify

- shared workflow module for pairing request queries
- CLI handler for `devices list`
- output formatting helper for list rendering
- related tests

#### Current code to inspect or reuse

- `/home/irving/webdev/openaidy/apps/server/src/websocket/pairing-service.ts`
- `/home/irving/webdev/openaidy/apps/server/src/websocket/pairing-service.test.ts`

#### Guidance for the agent

- inspect how pending requests are represented and persisted today
- return a stable read model for the CLI instead of exposing raw internal objects directly
- include request id and enough context for human approval decisions
- handle the empty state as a valid successful outcome

#### Tests expected

- listing pending requests successfully
- empty-state listing behavior
- deterministic ordering if the implementation chooses an order
- command-level rendering test for `devices list`

### Task 6: Implement pairing approval and denial workflows

#### Result expected

Provide shared workflows and CLI handlers for `openaidy devices approve <requestId>` and `openaidy devices deny <requestId>`. The result should reuse existing pairing business rules and provide explicit operator feedback.

#### Likely files to create or modify

- shared workflow module for pairing decisions
- CLI handlers for approve and deny commands
- output and error helper utilities
- related tests

#### Current code to inspect or reuse

- `/home/irving/webdev/openaidy/apps/server/src/websocket/pairing-service.ts`
- `/home/irving/webdev/openaidy/apps/server/src/websocket/pairing-service.test.ts`

#### Guidance for the agent

- reuse existing approval and denial logic rather than re-implementing request state transitions
- distinguish not found, expired, already processed, and unexpected failures clearly
- keep command output concise and auditable
- design results so future JSON output or audit logging can reuse them

#### Tests expected

- approve pending request success
- deny pending request success
- request id not found
- request already approved, denied, or expired
- persistence failure path if writes can fail
- command-level tests for both mutation commands

### Task 7: Standardize errors and exit codes

#### Result expected

Introduce a centralized error model for the CLI and shared workflows. The result should make failures consistent across commands and easy to extend for machine-readable output later.

#### Likely files to create or modify

- shared error/result definitions
- CLI exit handling utilities
- command handlers updated to use the centralized model
- tests for error mapping

#### Current code to inspect or reuse

- error cases implied by `/home/irving/webdev/openaidy/apps/server/src/bootstrap-admin.ts`
- request lifecycle and failure cases in `/home/irving/webdev/openaidy/apps/server/src/websocket/pairing-service.ts`

#### Guidance for the agent

- define explicit categories such as configuration error, bootstrap disabled, credentials missing, credentials malformed, request not found, request not actionable, persistence failure, and unexpected internal error
- keep user-facing messages specific and actionable
- avoid ad hoc error handling in each command file

#### Tests expected

- unit tests for error-to-exit-code mapping
- output tests for human-readable error rendering
- integration tests proving commands fail consistently across categories

### Task 8: Build out the full automated test suite for the first CLI slice

#### Result expected

Add strong automated coverage across CLI parsing, workflow behavior, and file-backed bootstrap token scenarios. The result should make the initial command set safe to refactor.

#### Likely files to create or modify

- CLI package test files
- shared workflow tests
- targeted updates to existing tests if extraction affects current modules

#### Current code to inspect or reuse

- `/home/irving/webdev/openaidy/apps/server/src/bootstrap-admin.test.ts`
- `/home/irving/webdev/openaidy/apps/server/src/websocket/pairing-service.test.ts`
- `/home/irving/webdev/openaidy/apps/server/src/app.test.ts`

#### Guidance for the agent

- mirror current Vitest conventions already used in the repo
- use temp directories or controlled fixtures for bootstrap token scenarios
- test observable behavior instead of private internals
- include both happy-path and failure-path coverage

#### Tests expected

- command parsing and help tests
- bootstrap token inspection tests
- pairing list tests
- pairing approve and deny tests
- regression tests for any extracted reusable logic

### Task 9: Write implementation-aligned documentation

#### Result expected

Create the docs that should ship with the CLI implementation. The result should explain operator usage, contributor architecture, repo-local execution, and future global installation clearly and accurately.

#### Likely files to create or modify

- `plans/control-plane/documentation-plan.md`
- control-plane overview document
- bootstrap-admin operator guide
- CLI getting started guide
- CLI command reference
- contributor architecture guide
- installation/distribution notes

#### Current code to inspect or reuse

- final CLI package and command handlers
- `/home/irving/webdev/openaidy/apps/server/src/bootstrap-admin.ts`
- `/home/irving/webdev/openaidy/apps/server/src/lib/env.ts`
- existing control-plane planning docs

#### Guidance for the agent

- document only behavior that exists as current behavior
- separate operator docs from contributor docs
- use real command examples taken from the implementation
- describe the repo-local-first story and the unchanged future global UX clearly

#### Tests expected

- manual verification that docs match the actual commands and paths
- run markdown linting if the repo already supports it

### Task 10: Leave clean extension points for future CLI growth

#### Result expected

Ensure the first implementation supports future JSON output, more commands, and published distribution without a redesign. The result should not overengineer those features now, but it should not block them either.

#### Likely files to create or modify

- CLI rendering helpers
- command registry structure
- package metadata and scripts
- shared service interfaces

#### Current code to inspect or reuse

- final CLI command handlers
- final CLI package metadata
- future-path sections of this plan

#### Guidance for the agent

- keep renderers abstract enough for future `--json`
- keep command names stable
- avoid local-only shortcuts that would make future distribution or remote reuse painful
- choose simple scalable patterns over premature complexity

#### Tests expected

- regression tests ensuring the current command contract stays stable during internal refactors
- package smoke validation for the executable path

## Definition of done for the first CLI slice

- repo-local `pnpm openaidy ...` execution works
- the four initial commands are implemented and tested
- bootstrap-admin behavior is reused from authoritative code instead of duplicated
- pairing administration flows are implemented through shared application services
- exit codes and error messages are consistent across commands
- documentation exists for both operators and contributors
- the structure is clean enough to support future JSON output and global installation

## Success criteria

- a developer in the repo can run the first `openaidy` commands through pnpm with stable naming
- the CLI reuses shared workflows rather than re-implementing server logic
- bootstrap-admin credentials must be handled safely
- the package boundaries for contributors are explained
- the command UX remains stable as distribution evolves
- the CLI implementation leaves a clean path to JSON output, package publishing, and future remote administration
- the first device administration commands work through a reusable control-plane layer
- the documentation explains both usage and architecture accurately
- the first iteration leaves a clean path to JSON output, package publishing, and future remote administration
