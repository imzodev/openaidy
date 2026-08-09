---
summary: 'Suggested data model for OpenAidy core services'
read_when:
  - You are designing persistence for OpenAidy
  - You want a starting point for database schema and service boundaries
title: 'OpenAidy Data Model'
---

# OpenAidy Data Model

This document proposes a relational data model for OpenAidy. It is intentionally conservative and service-oriented.

## Storage recommendations

Recommended default:

- PostgreSQL for production
- optional SQLite for local-only development or single-user experimentation

Use the relational database for:

- sessions
- transcript entries
- scheduled jobs
- run history
- pairing requests
- devices
- instances
- plugin state metadata

Use object storage or filesystem blobs for:

- attachments
- large artifacts
- exported transcripts
- generated files

## Core tables

### `sessions`

Purpose:

- stable logical conversation or execution container

Suggested fields:

- `id`
- `kind`
- `title`
- `agent_id`
- `source_type`
- `source_ref`
- `status`
- `created_at`
- `updated_at`
- `archived_at`
- `metadata_json`

Notes:

- `source_type` can describe where the session came from, such as channel, scheduler, UI, or webhook.
- `source_ref` can point at a channel thread ID, job ID, or external identifier.

### `session_messages`

Purpose:

- immutable transcript entries

Suggested fields:

- `id`
- `session_id`
- `kind`
- `role`
- `author_type`
- `author_id`
- `content_json`
- `created_at`
- `sequence`
- `parent_id`
- `metadata_json`

Notes:

- use append-only semantics
- `content_json` should store normalized message structure
- `parent_id` can help represent branches or tool-related sub-events

### `session_runs`

Purpose:

- track agent executions associated with sessions

Suggested fields:

- `id`
- `session_id`
- `agent_id`
- `status`
- `trigger_type`
- `trigger_ref`
- `started_at`
- `finished_at`
- `error_code`
- `error_message`
- `metadata_json`

### `session_artifacts`

Purpose:

- store generated outputs, files, and structured results

Suggested fields:

- `id`
- `session_id`
- `run_id`
- `artifact_type`
- `storage_url`
- `mime_type`
- `size_bytes`
- `created_at`
- `metadata_json`

## Scheduler tables

### `scheduled_jobs`

Purpose:

- persisted cron and one-off job definitions

Suggested fields:

- `id`
- `name`
- `status`
- `schedule_kind`
- `cron_expr`
- `run_at`
- `timezone`
- `target_type`
- `target_ref`
- `payload_json`
- `delivery_json`
- `retry_policy_json`
- `last_run_at`
- `next_run_at`
- `created_at`
- `updated_at`

### `job_runs`

Purpose:

- execution history for scheduled jobs

Suggested fields:

- `id`
- `job_id`
- `status`
- `attempt`
- `started_at`
- `finished_at`
- `error_code`
- `error_message`
- `result_json`
- `dispatch_run_id`

### `job_locks`

Purpose:

- prevent duplicate execution when multiple workers are running

Suggested fields:

- `job_id`
- `locked_by`
- `locked_until`
- `updated_at`

## Instance tables

### `instances`

Purpose:

- connected runtime registry

Suggested fields:

- `id`
- `instance_type`
- `display_name`
- `version`
- `status`
- `last_seen_at`
- `device_id`
- `metadata_json`

### `instance_capabilities`

Purpose:

- normalized capability records for instances

Suggested fields:

- `id`
- `instance_id`
- `capability`
- `value_json`
- `created_at`

### `instance_heartbeats`

Purpose:

- optional heartbeat history for debugging and audit

Suggested fields:

- `id`
- `instance_id`
- `recorded_at`
- `status`
- `details_json`

## Pairing tables

### `devices`

Purpose:

- trusted device and runtime identities

Suggested fields:

- `id`
- `public_key`
- `display_name`
- `platform`
- `device_family`
- `status`
- `created_at`
- `updated_at`
- `metadata_json`

### `pairing_requests`

Purpose:

- pending and resolved trust requests

Suggested fields:

- `id`
- `device_id`
- `requested_role`
- `requested_scopes_json`
- `status`
- `requested_at`
- `resolved_at`
- `resolved_by`
- `reason`
- `metadata_json`

### `device_tokens`

Purpose:

- issued device reconnect tokens

Suggested fields:

- `id`
- `device_id`
- `role`
- `scopes_json`
- `token_hash`
- `created_at`
- `rotated_at`
- `expires_at`
- `revoked_at`

## Channel tables

### `channel_accounts`

Purpose:

- configured accounts for channel plugins

Suggested fields:

- `id`
- `channel_type`
- `plugin_id`
- `account_key`
- `status`
- `config_json`
- `created_at`
- `updated_at`

### `channel_bindings`

Purpose:

- mapping between channel threads and sessions

Suggested fields:

- `id`
- `channel_account_id`
- `conversation_key`
- `session_id`
- `created_at`
- `updated_at`

## Plugin tables

### `plugins`

Purpose:

- installed plugin registry

Suggested fields:

- `id`
- `kind`
- `version`
- `status`
- `source_type`
- `source_ref`
- `manifest_json`
- `created_at`
- `updated_at`

### `plugin_configs`

Purpose:

- persisted validated config per plugin

Suggested fields:

- `id`
- `plugin_id`
- `config_json`
- `schema_version`
- `updated_at`

### `plugin_permissions`

Purpose:

- granted capabilities per plugin

Suggested fields:

- `id`
- `plugin_id`
- `capability`
- `granted`
- `constraints_json`

## MCP tables

### `mcp_servers`

Purpose:

- registry of configured MCP servers

Suggested fields:

- `id`
- `name`
- `transport_type`
- `endpoint`
- `status`
- `config_json`
- `created_at`
- `updated_at`

### `mcp_tool_cache`

Purpose:

- optional cache of discovered MCP tool metadata

Suggested fields:

- `id`
- `server_id`
- `tool_name`
- `schema_json`
- `updated_at`

## Important constraints

Recommended invariants:

- `session_messages.sequence` should be unique within a session
- `channel_bindings` should have a unique constraint on channel conversation identity
- only one active non-revoked device token should exist per device, role, and scope set unless rotation policy says otherwise
- `job_locks.job_id` should be unique
- `instances.id` should be stable across reconnects for the same runtime when possible

## Auditing

You may also want an `audit_events` table for:

- pairing decisions
- plugin install and uninstall
- config changes
- permission grants
- job disablement
- manual dispatch actions

## Migration philosophy

Start simple and preserve room for change:

- prefer additive schema evolution
- store complex payloads in JSON only when they are not primary query paths
- normalize identities, bindings, and permissions early
