---
id: cremk649
opened: 2026-10-17T23:58:12.000Z
closed: 2026-10-23T14:07:46.000Z
title: A layout error causes cascading unknown layout errors
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: [a14a08c]        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title:
proposal_title:
decision_title:
---

## Problem

When one layout fails to compile, layout-data registers nothing at all, so every block adds an `unknown layout` error, and the real error is buried in the noise.

## Proposal

When the layout registration fails, no longer add a cascading `unknown layout` error for each block.

## Decision

The issue holds; fixed as proposed: when the layout registration fails, the existence of the data blocks' layouts is not checked; the other checks of the data blocks run as usual.
