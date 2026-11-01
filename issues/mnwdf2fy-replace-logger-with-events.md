---
id: mnwdf2fy
opened: 2026-10-23T13:15:47.067Z
closed: 2026-10-24T18:26:07.000Z
title: Diagnostics go to an injected logger, and callers cannot handle them as events
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: [d005ad7, 10d51f8]        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title:
proposal_title:
decision_title:
---

## Problem

Location: `normalize_logger` and `log_events` in `src/server.js`, `create_handler` in `src/unit_map.js`, the constructor in `src/emulator.js`.

This package formats diagnostics as text and passes them to a `logger` (`info` / `warn` / `error`) injected by the caller:

- the server events `start`, `stop`, `socket_*`, `error` and `handler_error` are turned into log text by `log_events`;
- unmapped addresses found by the handler are reported through `logger.warn`.

So the caller only gets text and cannot handle diagnostics by type (e.g. count unmapped addresses, react to the errors of one server), nor tell which server an event came from. The logger also has to be passed down layer by layer (emulator → factory → handler) and is wrapped twice: `Modbus_Emulator` already calls `normalize_logger`, and the server factory wraps it again.

## Proposal

Remove the `logger` option together with `normalize_logger` and `log_events`, and use events instead. Events are emitted by their sources and gathered by `Modbus_Emulator`:

- Server level: es-modbus's `Modbus_Server` is itself an `EventEmitter` and already has the events above. The factories no longer wrap them; callers assembling by hand subscribe on the server directly.
- Handler level: the handler returned by `create_handler` is itself an `EventEmitter` and emits the unmapped address events. The handler is shared by several servers, and a call has only `addr` and `unit_id`, so it cannot be attributed to a server; only the handler can emit them. Deduplication stays as it is and applies to emitting events: the same address is emitted only once, at most 1024 emitted addresses are recorded, and when full a "no longer reported" notice is emitted once; later addresses are neither emitted nor recorded.
- `Modbus_Emulator` extends `EventEmitter`: it forwards the events of each server and of the handler. The emulator gives the server label to the server as the es-modbus `name` option, and the source of an event is known from `server.name`. A caller using the emulator only needs to listen to the emulator.
- The `error` event: `EventEmitter` throws when `error` is emitted without listeners. Once `log_events` is removed, the server's `error` has no default listener any more, and a single connection error could crash the process. So the emulator always listens to each server's `error` and forwards it under another name (e.g. `server_error`, payload `{ server, error }`), never emitting its own `error`. Callers using the factories directly must listen to the server's `error` themselves, as stated in the spec.
- Diagnostics during construction (e.g. the warnings of issue#rks1v7pr) happen before the caller can attach listeners; they do not use events and are collected in the emulator's `warnings` property.

Event names and payloads:

- Emitted by the handler:
  - `unmapped`, payload `{ kind, unit_id, addr }`, with `kind` being `"holding_register"` / `"input_register"` / `"coil"`; deduplicated as above, the same address is emitted only once.
  - `unmapped_limit`, payload `{ limit }`: emitted once when the emitted addresses reach the limit (1024); later addresses are no longer emitted.
  - `listener_error`, payload `{ block, error }`: an exception thrown by a block's listener (`change` / `write` / `access`) in the commit phase; the data is already written and the master receives a normal response (issue#6w441q89, issue#0t1q0fs7).
- Forwarded by the emulator:
  - Server events all get the prefix `server_`: `server_start`, `server_stop`, `server_socket_connect`, `server_socket_disconnect`, `server_socket_error`, `server_error`, `server_handler_error`, `server_receive`, `server_send`. The payload is `{ server, ... }`, with the original es-modbus arguments in named fields (`socket` / `error` / `frame`); `server.name` is the server label, e.g. `servers[1] (modbus://0.0.0.0:503)`, which the errors of `start()` also use.
  - Handler events are forwarded with their original names and payloads.
- Invalid values returned by the handler (a batch read result of the wrong length, a register value out of range) are validated by es-modbus and reported as `handler_error`; the master receives 0x04, and the emulator forwards it as `server_handler_error`; no separate event is added. This package's handler builds the return values from the blocks' bytes, so an invalid value can only be a defect of this package.

The spec / design (including the Chinese versions), `src/index.d.ts` and the README need to be updated. This is a breaking change.

## Decision

The issue holds; fixed as proposed: `logger` is removed, the handler and the servers emit events, and the emulator gathers and forwards them; the server label is the server's `name`, and payloads carry no separate label; diagnostics during construction are collected in `warnings`.
