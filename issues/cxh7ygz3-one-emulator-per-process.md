---
id: cxh7ygz3
opened: 2026-10-17T23:58:20.000Z
closed: 2026-10-24T16:18:10.000Z
title: The once-per-process layout registration constraint is not in the spec
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: [6a67012]        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title:
proposal_title:
decision_title:
---

## Problem

`register_layout` can succeed only once per process; this is the design of layout-data. Consequently, a description with layouts (`layouts` or `layouts_file`) can construct an emulator only once per process, whether it succeeds or fails. The spec does not state this constraint, nor what to do when several instances are needed or an instance must be rebuilt within the same process.

## Proposal

State in the spec (including the Chinese version):

- A description with layouts can construct an emulator only once per process; when the description is wrong, correct it and restart the process.
- To run several emulators in one process, or to rebuild instances without touching the layouts (e.g. changing ports or IPs), make the layouts independent of the instances: first register all layouts separately with the `register_layout` this package re-exports, and let the descriptions carry no layouts and only reference layout names; such descriptions can be constructed several times in one process.

## Decision

The issue holds; fixed as proposed: the spec (including the Chinese version) states that a description with layouts can be constructed only once per process, that after an error it is corrected and the process restarted, and the usage of registering layouts separately with descriptions only referencing layout names; the design's "one emulator per process" wording is changed to the exact constraint as well.
