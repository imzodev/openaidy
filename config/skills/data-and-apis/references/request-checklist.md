# Request checklist

Read is cheap and reversible; write is neither. Treat them differently.

## Any request

- [ ] Tool/MCP server available and holding its own credentials.
- [ ] Endpoint or table, parameters, and expected response shape known.
- [ ] Auth and rate limits respected; pagination handled.
- [ ] Secrets never printed, logged, or pasted into chat.

## Reads

- [ ] Started read-only to understand the data.
- [ ] Inputs parametrized, not string-concatenated.
- [ ] Result bounded — `LIMIT`, date range, or page size.
- [ ] Errors and empty results read and reported, not retried blindly.

## Writes / side effects

- [ ] Stated exactly what will change, to which records.
- [ ] User confirmed the write (or clearly pre-authorized it).
- [ ] Tried a dry run or single-record test before any bulk operation.
- [ ] Read the affected record back afterward to confirm the change.
- [ ] Idempotency considered so a retry can't double-apply.
