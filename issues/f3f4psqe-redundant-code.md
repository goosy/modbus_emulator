---
id: f3f4psqe
opened: 2026-10-17T23:58:30.000Z
closed: 2026-10-23T13:32:37.000Z
title: Redundant code
status: fixed       # open | accepted | fixed | rejected | wontfix
labels: []
remote:
---

## Problem

- The `block_options` parameter of `#read_blocks` has no effect (`new Ldata` takes only two arguments), and the call site never passes it;
- the handling of `layouts_file` throws inside a try and catches it itself, where the error could be pushed directly.

## Proposal

Remove the ineffective parameter `block_options`; push the error directly where `layouts_file` is handled.

## Decision

The issue holds; fixed as proposed: both are ineffective or roundabout code, and removing them does not change the behavior.
