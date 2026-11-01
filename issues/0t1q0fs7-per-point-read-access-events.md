---
id: 0t1q0fs7
opened: 2026-10-17T23:58:14.000Z
closed: 2026-10-24T09:58:01.000Z
title: Per-point reads make access events repeated and imprecise
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: [f465cb4, 6e53415]        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title:
proposal_title:
decision_title:
---

## Problem

Location: `get_holding_register` / `get_input_register` / `get_coil` in `src/unit_map.js`.

es-modbus calls the handler once for each register of FC3 / FC4 and once for each coil of FC1 / FC2; the handler calls `Ldata.read_bytes` once per call, and each `read_bytes` emits one `access("read", tags)`. `access` is a diagnostic means of layout-data, e.g. for checking the dependencies a rule declares against the ones it actually has; for the emulator, one request of the master is one read, and the two points below distort the diagnosis.

- Repeated: a request that reads n points emits `access` n times. Measured: FC3 reading 4 registers covering `id` (UInt), `status` (Word) and `pressure` (Real) emits 4 times, with `pressure` appearing twice; FC1 reading the 16 coils of `status` emits 16 times.
- Imprecise: `read_bytes` has no bit mask, so reading one coil reports every Bool in the same byte as read. Measured: reading coil 17 (not a bit of `alarm`) also reports `alarm`. `write_bit` in the write direction takes a mask and is precise; layout-data 0.2.0 has no corresponding bit read.

`Ldata.transaction` of layout-data 0.2.0 does not solve it: it only defers `change` and `write`; `access` is emitted immediately on each read or write call, and writes rolled back inside a transaction still emit `access write` (measured). layout-data 0.3.0 has brought `access` into `transaction` and added the bit read `read_bit`; see the proposal.

A secondary impact is overhead: for each point, a linear scan of the segments and the allocation of a result object and a Buffer copy. Measured (4 blocks, reading the last block): FC3 reading 125 registers takes about 10 µs point by point and about 0.2 µs with one `read_bytes`; compared with the communication time (a LAN TCP round trip of hundreds of microseconds to milliseconds, about 265 ms to transmit 255 bytes over RTU at 9600 baud) this is negligible and not worth fixing on its own.

For the write direction, see issue#6w441q89.

## Proposal

Make one read request emit exactly one precise `access` per block. Three parts work together:

- External dependency es-modbus (es-modbus#yjaww5qx): 0.3.0-beta.4 already provides the optional batch read methods `get_holding_registers` / `get_input_registers` / `get_coils`, each called only once for one FC3 / FC4 / FC1 request; when the handler has no discrete input method, FC2 also calls `get_coils`. In this package coils and discrete inputs have the same content, so no discrete input method is provided. This package already pins that version (issue#61qwgnt5). Per-point calls do not know the boundaries of the request, so this package cannot wrap one request in one transaction; the batch methods are therefore required.
- External dependency layout-data: 0.3.0 already provides the following two items.
  - A bit read `read_bit(offset, mask)` symmetric to `write_bit` (layout-data#dy6d5xgj), so that reading coils makes `access` report only the Bools that are read.
  - `access` brought into `transaction` (layout-data#jt0zxgth): inside a transaction the tags involved are accumulated separately for `read` and `write`, and each kind is emitted once on commit; on rollback `access write` is discarded. `access read` is still emitted on rollback; once deferred, a listener can no longer veto a read by throwing; see that issue for the semantics.
- This package: the handler implements the batch read methods, splits the request by block, and reads each block's part in that block's `transaction` (one `read_bytes` for registers, `read_bit` bit by bit for coils); the gaps between blocks are still read as 0 / false and reported as unmapped addresses. The overhead problem disappears along with it.

Both external dependencies have been released (es-modbus 0.3.0-beta.4, layout-data 0.3.0); what remains is the implementation on this package's side.

Rejected alternatives:

- Wrapping the reads in `transaction` within per-point calls: per-point calls do not know the boundaries of the request, so one request cannot be wrapped in one transaction (and `transaction` in layout-data 0.2.0 does not defer `access` either).
- Reading coils with one `read_bytes` over the whole byte range: the count is right, but it still reports by byte and is imprecise.
- Ruling wontfix on the overhead alone: the overhead is indeed negligible, but the repetition and imprecision of `access` are correctness problems.

## Decision

The issue holds; fixed as proposed: the handler implements the batch read methods, splits the request by block and reads each block in a `transaction` (one `read_bytes` for registers, `read_bit` bit by bit for coils), so one read request emits exactly one precise `access` per block.
