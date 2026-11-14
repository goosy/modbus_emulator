---
id: nph2fayr
opened: 2026-10-17T23:58:09.000Z
closed: 2026-10-23T14:07:46.000Z
title: Unknown keys in the description file are silently ignored
status: fixed       # open | accepted | fixed | rejected | wontfix
labels: []
remote:
---

## Problem

Misspelled keys in the description file (e.g. `sart` for `start`, `unitid` for `unit_id`) report no error, and the block is attached with default values (e.g. at offset 0).

## Proposal

Unknown keys in data block entries and server entries are collected in `errors` as errors. Server entries are checked by protocol: `tcp` / `rtu_over_tcp` do not accept serial parameters, and `rtu` does not accept `host`.

Root keys are not checked: root keys other than `blocks`, `servers` and `layouts_file` are layout-data fragment names, and a misspelled root key cannot be told apart from a fragment.

## Decision

The issue holds; fixed as proposed: unknown keys of data block entries and server entries are collected in `errors`, with server entries checked by protocol; root keys are not checked.
