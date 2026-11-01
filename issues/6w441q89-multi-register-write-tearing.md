---
id: 6w441q89
opened: 2026-10-17T23:58:04.000Z
closed: 2026-10-24T09:55:55.000Z
title: Multi-register writes produce intermediate values (tearing)
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: [f465cb4, d6dd46d]        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title:
proposal_title:
decision_title:
---

## Problem

Location: `set_holding_register` / `set_coil` in `src/unit_map.js`.

es-modbus calls the handler once for each register of FC16 and once for each coil of FC15; this package calls `write_bytes` / `write_bit` once per call, and each call detects changes and emits events.

- Consistency: a tag spanning two registers (e.g. a Real) receives one `change` with an intermediate value. The design's statement that "callers coalesce notifications with `setImmediate`" can only coalesce events; it cannot eliminate intermediate values.
- Overhead: a request writing n points does n change detections and emits the block's `write` n times; the total cost of `write` listeners is multiplied by n accordingly. Measured with FC16 writing 125 registers, with different values each time: 13.5 µs point by point, 7.7 µs with one `write_bytes`; with a `change` listener on every tag, 18.9 µs and 10.0 µs; the per-point way emits `write` 125 times per request, the batch way once.
- Diagnostics: each `write_bytes` / `write_bit` emits one `access("write", tags)`, so a request writing n points emits it n times.

## Proposal

Implement the optional es-modbus batch methods `set_holding_registers(addr, values, unit_id)` / `set_coils(addr, values, unit_id)`: es-modbus calls them only once for one FC16 / FC15 request, passing all the values of that request. FC6 / FC5 still call `set_holding_register` / `set_coil`, unchanged.

- The handler splits the request range by block. Each block's part is written in that block's `transaction`: registers are assembled into bytes and written with one `write_bytes`; coils are written with `write_bit` per byte (keeping the bitwise write range, so `access` reports only the Bools written). When a request spans several blocks, the `transaction`s of those blocks are nested one inside another and completed within one synchronous call. The gaps between blocks are still ignored and reported as unmapped addresses.
- Verified with a prototype (in the form of overriding `dispatch`, with the same nesting): one FC16 writing 8 registers across two blocks gives each tag only one `change`, with the final value (`1.5→1234.5`); each block has only one `write`; a listener of one block throwing does not prevent the other block from committing.
- `access`: layout-data 0.3.0 brings `access` into `transaction` (layout-data#jt0zxgth): `access` within a transaction is emitted once each for `read` / `write` at the end, and `access write` is not emitted on rollback. So both registers (one `write_bytes` per block) and coils (one `write_bit` per byte) give one `access` per block.
- The external dependencies are all released: the es-modbus batch methods are in 0.3.0-beta.4 (issue#61qwgnt5), and layout-data's `access` in `transaction` is in 0.3.0.

Semantics settled along with it (written into the spec / design first, including the Chinese versions):

- One FC16 / FC15 request emits one `write` for each block written (currently one per point); FC6 / FC5 are unchanged.
- The request is atomic: when an exception is thrown in the middle of writing, all the blocks involved are rolled back and the master receives 0x04 (currently the first part stays written).
- An exception thrown by a listener in the commit phase: the data is already written, is not rolled back, and does not affect other blocks. The handler catches it and reports it itself (the reporting way is settled with issue#mnwdf2fy) and does not throw it to es-modbus, so the master receives a normal response; if it were thrown, es-modbus would answer the already written request with 0x04 and emit `handler_error`.
- When nested, the inner one commits first. Nest the blocks in reverse address order so that events are emitted in address order.
- It is implemented by the handler, so a `Modbus_Server` the caller builds with `create_handler` has the same behavior.
- `access`: one FC16 / FC15 request emits one `access write` for each block written.
- Remove the `setImmediate` coalescing statement from the design.

Tests: FC16 and FC15 across blocks, no intermediate value for a Real, one `write` per block, one `access` per block for register and coil writes, rollback on an exception in the middle, a listener exception not affecting the response.

Rejected alternatives:

- Using `transaction` within per-point calls: not possible; `Ldata.transaction(fn)` requires all writes to complete synchronously inside the callback, and per-point calls do not know the boundaries of the request.
- Subclassing `Modbus_Server` and overriding `dispatch` to nest `transaction` at the request level: feasible, but it depends on the internal call structure of es-modbus and protects only servers created by this package's factories; the batch methods are the official extension point es-modbus provides.

For the `access` problem in the read direction, see issue#0t1q0fs7.

## Decision

The issue holds and must be fixed: when the master writes values of several registers at once, tags receive wrong intermediate values, and each point triggers a change detection and a `write`. Adopt the proposed solution: implement the es-modbus batch write methods `set_holding_registers` / `set_coils`, and use `transaction` so that one request writes each block atomically.
