---
id: ww7asdqc
opened: 2026-10-17T23:58:10.000Z
closed: 2026-10-23T14:07:46.000Z
title: Read errors are not in errors
status: fixed       # open | accepted | fixed | rejected | wontfix
labels: []
remote:
---

## Problem

Location: `readFileSync(item, "utf8")` in `src/emulator.js`.

When the file does not exist, the raw `ENOENT` is thrown without an `errors` property, inconsistent with the rule "collect all violations and throw them at once".

## Proposal

Collect read errors such as a missing file in `errors` as well.

## Decision

The issue holds; fixed as proposed: read errors are collected in `errors` as `cannot read the file: <original message>`, prefixed with the file name when there are several files.
