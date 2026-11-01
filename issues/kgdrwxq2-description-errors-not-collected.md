---
id: kgdrwxq2
opened: 2026-10-24T15:01:24.251Z
closed: 2026-10-24T16:20:22.000Z
title: Some description errors are thrown directly instead of collected in errors
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: [a03e9cc]        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title:
proposal_title:
decision_title:
---

## Problem

Location: `#read_blocks` and `#read_servers` in `src/emulator.js`.

The spec states: when a description is invalid, the constructor throws one `Error` whose `errors` property lists all violations. The following two kinds of errors are not validated by the emulator but thrown by the dependencies (layout-data, es-modbus), bypassing this rule:

- A block name that is not a string (e.g. `name: 123`): the emulator does not check the type of block names, so `new Ldata(layout, name)` in the validation loop throws layout-data's `TypeError` and the validation aborts midway.
- Invalid serial parameters of an RTU server (e.g. `baud_rate: -1`, `data_bits: 9`): `#read_servers` checks only the serial port path, not `baud_rate`, `parity`, `data_bits` and `stop_bits`; es-modbus throws when the servers are created after all validation has passed.

Impact: the caller receives an exception without an `errors` property. A block name error also drops the violations collected before it; a serial parameter error appears only when there are no other violations, and cannot be reported together with them.

## Proposal

Add these two checks in the validation phase, collecting violations in `errors`:

- Block name: when given, it must be a non-empty string.
- Serial parameters: ranges consistent with es-modbus: `baud_rate` a positive integer, `parity` `none` / `odd` / `even`, `data_bits` 5, 6, 7 or 8, `stop_bits` 1, 1.5 or 2.

Tests: both errors appear in `errors` and are reported together with other violations.

## Decision

The issue holds; fixed as proposed: the validation phase checks that block names are non-empty strings and that RTU serial parameters are consistent with es-modbus, collecting violations in `errors` and reporting them together with other violations.
