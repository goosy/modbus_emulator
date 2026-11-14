---
id: 0vdz2x70
opened: 2026-10-17T23:58:07.000Z
closed: 2026-10-23T14:07:46.000Z
title: The block offset is not required to be even
status: fixed       # open | accepted | fixed | rejected | wontfix
labels: []
remote:
---

## Problem

Location: `#read_blocks` in `src/emulator.js`.

Only a non-negative integer is checked. An odd `offset` makes the effective length of the block in the unit odd, and the last register reads past the end of the block.

Reproduction: with `offset: 1`, reading the last register makes `read_bytes` throw a RangeError, and the master receives exception code 0x04.

layout-data already rejects layouts whose length is not a whole number of registers, so the problem comes only from `offset`.

## Proposal

Require `offset` to be a non-negative even number in the validation, and update the spec accordingly.

## Decision

The issue holds; fixed as proposed: an odd `offset` makes the master read past the end of the block, so the validation requires it to be a non-negative even number.
