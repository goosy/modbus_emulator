---
id: gcjgyp5s
opened: 2026-10-28T17:28:21.928Z
closed: 2026-10-29T04:58:18.000Z
title: get_coil reads the bit with read_bytes, so access reports every Bool of the byte
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: [ae3d8d7]        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title:
proposal_title:
decision_title:
---

## Problem

The handler's batch method `get_coils` reads coils with `block.read_bit(offset, bit_mask)`, while the single `get_coil` uses `(block.read_bytes(offset, 1)[0] & bit_mask) > 0`. The two give different `access` events: reading the same coil, `read_bytes` reports every Bool in that byte (e.g. `c0,c1`), while `read_bit` reports only the one read (`c0`), as verified with a script.

es-modbus does not call `get_coil` when the handler has `get_coils`, so FC 1 / FC 2 requests are not affected; but `get_coil` is a public handler method, and users calling it directly see an `access` inconsistent with the batch read.

## Proposal

Change `get_coil` to `return block.read_bit(offset, bit_mask);`. `read_bit` is exactly what layout-data provides for this (layout-data issue#dy6d5xgj: reports only the Bool of the bit read); after the change the `access` of single and batch reads is consistent, and the code has one expression less.

## Decision

Fix. `get_coil` uses `read_bit`, so the `access` of single and batch reads is consistent, both reporting only the Bool of the bit read.
