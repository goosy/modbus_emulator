---
id: rks1v7pr
opened: 2026-10-17T23:58:13.000Z
closed: 2026-10-24T18:27:41.000Z
title: RTU unit 0 and the reserved addresses are not explained
status: fixed       # open | accepted | fixed | rejected | wontfix
labels: []
remote:
---

## Problem

Under RTU, unit 0 is the broadcast address: es-modbus only executes writes to it and does not respond. A block attached at unit 0 is not readable by an RTU master. 248..255 are reserved addresses on a serial bus. The spec allows `unit_id` to be 0..255 without explaining these semantics, and the validation gives no hint.

## Proposal

Explain it in the spec, and give a warning (not an error) during validation: a warning is produced when the units answered by a server on a serial bus (`rtu` and `rtu_over_tcp`, i.e. the servers whose protocol in es-modbus is not `tcp`, all of which treat unit 0 as broadcast) include 0 or 248..255.

The warnings are produced during construction, before the caller can attach listeners, so they do not use events and are collected in the emulator's `warnings` property (see issue#mnwdf2fy).

Tests: a warning is produced when the units of an `rtu` or `rtu_over_tcp` server include 0 or 248..255; a `tcp` server produces none.

Rejected alternative: reporting through the logger, which will be removed (issue#mnwdf2fy).

## Decision

The issue holds; fixed as proposed: the spec states that on a serial bus unit 0 is broadcast and 248..255 are reserved addresses; when a server whose protocol is not `tcp` answers these units, a warning is given in `warnings`.
