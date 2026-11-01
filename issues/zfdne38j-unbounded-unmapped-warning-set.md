---
id: zfdne38j
opened: 2026-10-17T23:58:15.000Z
closed: 2026-10-23T14:39:05.000Z
title: The set of unmapped address warnings is unbounded
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: [10478ec]        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title:
proposal_title:
decision_title:
---

## Problem

Location: `reported` in `src/unit_map.js`.

One entry is recorded per (kind, unit, address). When a master scans the whole address space, it can in theory reach 65536 × 3 × 256 entries.

## Proposal

Set a limit: at most 1024 reported addresses are recorded; when full, a "no longer reported" warning is reported once, and later addresses are neither reported nor recorded.

After switching to events (issue#mnwdf2fy), unmapped addresses are emitted as events by the vector, and deduplication is still done by this package, applied to emitting events: the same address is emitted only once.

Rejected alternatives:

- Emitting an event on every access and letting subscribers deduplicate: a polling master would keep flooding the listeners.
- Deduplicating by range: scanning the whole address space can still produce many ranges, and merging ranges is complex to implement, gaining only more compact warnings.

## Decision

The issue holds; fixed as proposed: a limit of 1024 makes the set bounded, and when it is exceeded the caller is told explicitly that no more are reported.
