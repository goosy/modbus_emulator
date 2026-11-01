---
id: z9pjkrfa
opened: 2026-10-17T23:58:21.000Z
closed: 2026-10-24T18:28:29.000Z
title: The argument order of create_tcp_server
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: [be513a3]        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title:
proposal_title:
decision_title:
---

## Problem

`create_tcp_server(host, port, unit_map, opts)` puts optional parameters before the required one; using only the defaults requires writing `create_tcp_server(undefined, undefined, unit_map)`; it is also inconsistent with the style of `create_rtu_server(path, unit_map, opts)`.

## Proposal

Change it to `create_tcp_server(unit_map, { host, port, rtu, ... })`, consistent with the style of `create_rtu_server`. This is a breaking change.

## Decision

The issue holds; fixed as proposed: `create_tcp_server(unit_map, { host, port, rtu, unit_ids, handler, name })`, with the required unit table first and everything else as options, consistent with `create_rtu_server` and es-modbus's `Modbus_Server(handler, options)`.
