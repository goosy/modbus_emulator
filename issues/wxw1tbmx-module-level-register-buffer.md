---
id: wxw1tbmx
opened: 2026-10-17T23:58:16.000Z
closed: 2026-10-24T01:40:33.000Z
title: Module-level shared buffer
status: rejected    # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title:
proposal_title:
decision_title:
---

## Problem

Location: `REGISTER_BYTES` in `src/unit_map.js`.

`set_holding_register` writes the register value into a module-level shared two-byte array and passes it to `write_bytes`. The review considered this to depend on the implicit premise that "the call is synchronous and `write_bytes` copies immediately".

## Proposal

This premise is not implicit but well founded.

- `write_bytes` first copies the source bytes into the block's buffer, and only then detects changes and emits events; even if a `change` / `write` listener calls the handler again synchronously, the shared array has already been copied by then.
- Both the design and the code comment already state that "`write_bytes` copies immediately".

After switching to batch writes (issue#6w441q89), FC6 still calls `set_holding_register`, and this array stays in use; it will not be removed.

## Decision

The issue does not hold (rejected): `write_bytes` copies the source bytes before detecting changes and emitting events, so using the shared array is safe, and this premise is already written in the design and the code comment.
