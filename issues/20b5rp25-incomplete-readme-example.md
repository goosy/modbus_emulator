---
id: 20b5rp25
opened: 2026-10-17T23:58:29.000Z
closed: 2026-10-23T13:32:37.000Z
title: The README example is incomplete
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: [e7d125a]        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title:
proposal_title:
decision_title:
---

## Problem

In the "Without a description file" example, `block` is undefined, and registering the layout and creating the Ldata are not shown.

## Proposal

Complete the layout registration and the Ldata creation. The example does not pass `logger`: it will be replaced by events (issue#mnwdf2fy).

## Decision

The issue holds; fixed as proposed: the example runs as written.
