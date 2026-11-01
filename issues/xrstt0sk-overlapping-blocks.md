---
id: xrstt0sk
opened: 2026-10-17T23:58:08.000Z
closed: 2026-10-24T12:55:35.000Z
title: Overlapping address ranges of blocks within one unit are not detected
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: [522b4ca]        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title:
proposal_title:
decision_title:
---

## Problem

Location: `attach_unit` in `src/unit_map.js`.

Overlapping blocks are constructed successfully; reads and writes hit the block attached first, and the block attached later is unreachable in the overlapping part, without any hint.

## Proposal

Detect overlapping byte ranges of blocks within one unit and report an error. Put the check in `attach_unit`, so that callers assembling a `Unit_Map` by hand are protected as well.

Tests: an error is reported when blocks overlap within one unit, covering both paths, construction from a description file and assembling a `Unit_Map` by hand.

## Decision

The issue holds; fixed as proposed: before the ordered insertion, `attach_unit` checks whether the new segment overlaps its neighbouring segments, and on overlap throws an `Error` naming both data blocks, leaving the unit table unchanged; at construction the emulator reports it as an error of that data block entry along with the others.
