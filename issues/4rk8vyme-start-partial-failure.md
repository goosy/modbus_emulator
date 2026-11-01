---
id: 4rk8vyme
opened: 2026-10-17T23:58:05.000Z
closed: 2026-10-23T14:43:50.000Z
title: After a failed start some servers keep running, and only the first error is reported
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: [69f738d]        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title:
proposal_title:
decision_title:
---

## Problem

Location: `start()` in `src/emulator.js`.

`Promise.all` rejects on the first failure, and servers already started are not rolled back.

Reproduction: with two servers, one of them with port 99999, `start()` is rejected, while the other server keeps listening afterwards. The caller gets a failure, yet an unmanaged socket stays in the process.

In addition, `start()` throws only the first error without saying which server failed, and the failures of the other servers are dropped.

## Proposal

es-modbus behavior that can be relied on: each server's `start` / `stop` are queued internally; `stop()` runs only after the preceding `start` has finished, and never rejects; calling `stop()` on a server that was never started returns immediately; calling `start()` on a running server stops it first and then starts it.

- `start(options)` uses `Promise.allSettled` to wait until every server has a result, then handles the failures.
- Default (all or nothing): if any server fails, call `stop()` to stop all servers (including those already running before the call, since `start()` itself is a restart), then throw an `AggregateError`. A successful `start()` means all servers are running; a failed one means all are stopped.
- `{ partial: true }` (best effort): servers that started successfully keep running and are not rolled back. Whenever there is a failure, the same `AggregateError` is still thrown, so that failures cannot be ignored; the two modes differ only in whether the other servers are stopped. Intended for debugging, e.g. when the serial port is unplugged, the TCP servers remain usable.
- The `AggregateError` lists all failures. Each item is an `Error` whose message identifies the server, e.g. `servers[1] (modbus://0.0.0.0:503): EADDRINUSE`, with the original error in `cause`.
- The server label (the position `servers[i]` in the description and the address) is stored at construction and shares the same data with issue#31epb8mc.
- `stop()` keeps `Promise.all` unchanged.
- Relation to issue#2jdmx0kw: the port range validation only blocks configuration errors; runtime failures such as a port in use (EADDRINUSE) or a missing serial port still happen, so the handling here is still needed.
- Change the spec / design (including the Chinese versions) and `src/index.d.ts` (`start(options?: { partial?: boolean })`) first.

Tests: occupy a port; in the default mode the other server is stopped, in the partial mode the other server keeps listening, and both modes throw an `AggregateError`.

## Decision

The issue holds and must be fixed: a failed `start()` leaves servers running, and the failure report is incomplete. Adopt the proposed solution: all or nothing by default, best effort with `{ partial: true }`; both modes throw an `AggregateError` listing all failures.
