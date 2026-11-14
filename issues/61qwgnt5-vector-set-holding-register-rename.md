---
id: 61qwgnt5
opened: 2026-10-24T05:16:05.092Z
closed: 2026-10-24T07:17:14.000Z
title: es-modbus renamed vector to handler; all register writes fail and handler errors are no longer logged
status: fixed       # open | accepted | fixed | rejected | wontfix
labels: []
remote:
---

## Problem

Location: `create_vector` in `src/unit_map.js`; `Modbus_Vector` in `src/index.d.ts`; `log_events` in `src/server.js`; the description of the vector method names and the `vector_error` event in the design (including the Chinese version).

es-modbus 0.3.0-beta.4 has two renames that concern this package, neither keeping the old name:

- The register write method `set_register` is renamed to `set_holding_register`, with the batch method correspondingly `set_holding_registers` (es-modbus `68a16aa`, es-modbus#yjaww5qx). This package's vector still provides `set_register`.
- The `vector` of `Modbus_Server` is now called `handler`: the property `vector` becomes `handler`, and the event `vector_error` becomes `handler_error` (es-modbus `36ac96a`, es-modbus#fnhetwc4). The constructor still receives it as its first argument, so this rename does not force this package's own vector naming (`create_vector`, `options.vector`, etc.) to change; but `log_events` still listens to `vector_error`.

Observed: running the current code with es-modbus 0.3.0-beta.4 (and the unreleased layout-data) referenced via yalc:

- On FC6 / FC16 register writes es-modbus cannot find the method; `handler_error` is `TypeError: this.handler[name] is not a function`, the master receives exception 0x04, and the write does not happen. Read requests and coil writes are not affected. 7 of the 41 tests fail, all of them register write cases.
- When the handler throws, the master still receives 0x04, but the error is no longer written to the log, because `handler_error` has no listener. The current tests do not cover this log line, so they do not reveal the problem; it is reproduced by sending an FC3 request with a vector that throws: listening to `vector_error` leaves the log empty, while listening to `handler_error` logs `server request failed: <message>`.

In a copy, after renaming the vector method to `set_holding_register` and changing the listened event to `handler_error`, all 41 tests pass and handler errors are logged; so for the new dependency versions these two points are the only runtime problems of the current code. The other changes do not affect the current code: FC2 falls back to `get_coil` when the vector has no discrete input method, as before; layout-data bringing `access` into `transaction` has no effect on this package yet, since this package does not use `transaction` yet; the new register value check of es-modbus is not triggered by the values this package returns.

## Proposal

Follow the es-modbus renames: rename the vector method to `set_holding_register`, and change the event listened to by `log_events` to `handler_error`. Since this package can accept breaking changes, also rename all vector-related naming in this package to handler, consistent with the es-modbus terminology, so that callers do not have to map two sets of terms between the two packages:

- Public interface: `create_vector` → `create_handler`; type `Modbus_Vector` → `Modbus_Handler`; property `vector` of `Modbus_Emulator` → `handler`; option `vector` of `create_tcp_server` / `create_rtu_server` → `handler`.
- Internal identifiers, comments and JSDoc (e.g. the local variable `vector` in `src/unit_map.js`, `_vector` in `src/server.js`).
- Calls, assertions and test names in the tests (e.g. "all the servers share one vector ...").
- Documentation: the vector wording, the method names and the `vector_error` event in the spec, the design (both including the Chinese versions) and the README, and the design's section title "Unit_Map and the Vector".

Put it in the same commit as the dependency upgrade: pin the dependency to the exact es-modbus version `0.3.0-beta.4`, which contains both renames (referenced via yalc before release; must be changed back to the version number before committing).

This package can accept breaking changes, so no aliases are needed for compatibility.

## Decision

The issue holds and is fixed: with es-modbus 0.3.0-beta.4 this package switches to `set_holding_register` and `handler_error`, and renames all its vector-related naming to handler, consistent with the es-modbus terminology; the dependency is pinned to the exact version `0.3.0-beta.4`.
