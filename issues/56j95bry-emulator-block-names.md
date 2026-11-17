---
id: 56j95bry
opened: 2026-11-16T23:09:57.917Z
closed: 2026-11-17T13:08:58.000Z
title: The emulator does not keep holding its block names; a failed start gives them back, and a start after stop holds them no more
status: fixed       # open | accepted | fixed | rejected | wontfix
labels: []
remote:
---

## Problem

Location: `start()`, `stop()` and `#release_blocks()` in `src/emulator.js`; the items `start(options)`, `stop()` and "Layout scope" of spec §4; the items `start(options)` and `stop()` of design §4.

Block names are held by their layouts (issue#99agfr7m): at `load` of an emulator, a layout creates a block and holds its name, and `stop()` gives the name back to the layout, so another instance in the same scope can load the same description after `stop()`. Two instances holding blocks of the same name in one scope at the same time is a configuration error, which different scopes should have avoided. But the error is not found in the two cases below:

1. **A failed start gives the block names back.** In the default (all or nothing) mode, when any service fails to start, `start()` calls `stop()` to stop all services, and `stop()` gives the block names back as well. The caller did not call `stop()`, yet the block names are given back: another instance in the same scope can then load blocks of the same names; once this instance retries `start()` and succeeds, it serves blocks of the same names at the same time as the other one, and `layout.get_ldata(name)` returns the block of the other instance. For a failure the spec says only "all services are stopped", not that the block names are given back.
2. **A `start()` after `stop()` holds the block names no more.** After `stop()` gives the block names back, the blocks stay in `blocks` and `start()` serves them again, but nobody holds their names any more. While this instance runs, another instance that loads blocks of the same names in the same scope succeeds, and two blocks of the same name run at the same time. To reproduce: instance A runs `load`, `stop()`, then `start()`; instance B loads the same description in the same scope, and succeeds.

Impact: the instances that are given no scope name all use the default scope `modbus_emulator`, so this is a risk of the default case. Retrying after a start that failed because a port was in use is a normal use, and should have no side effect of giving the block names back.

## Proposal

Direction: block names are held by the layouts only, and layout-data is the one record. An emulator holds its block names from `load` to `stop()`, and `start()` binds the names given back by `stop()` to their layouts again with `layout.add_ldata(ldata)` of layout-data 0.7.0, so while the services of the emulator run, its block names are always held by the layouts, and layout-data finds a conflict of names as before.

- `load`: unchanged. A conflict of block names is reported by the `load` of layout-data.
- `start()`: first checks each block of the emulator: a block whose name the layout holds for another Ldata (`layout.get_ldata(name)` returns another Ldata) is a conflict; with any conflict it refuses to start, starts no service, binds no name, and the error lists every conflicting block. Without conflicts, it calls `layout.add_ldata(block)` for each block whose name is not held, binding the name back and recording it as held, then starts the services.
- A failed start: only stops the services, and does not give the block names back. Only a call of `stop()` by the caller gives them back.
- `stop()`: unchanged; it stops the services and gives the held block names back, so a rebuild in the same scope after `stop()` is still possible (issue#99agfr7m).
- A block of the same name created by the caller with `layout.create_ldata`, bypassing the emulator: layout-data rejects it while the emulator runs; one created while the emulator is stopped is found at its next `start()`.
- The dependency of this package on layout-data is upgraded to 0.7.0, which provides `add_ldata`.

Rejected approaches:

- A module-level claim table in this package, recording by (scope, layout, block name) which instance claims which block: one more state beside layout-data; while an instance started again after `stop()` runs, `layout.get_ldata(name)` does not find its block; with two copies of this package in a process, their claim tables do not see each other.
- `stop()` does not give the block names back, and a separate `close()` gives them back when the instance is destroyed: it overturns the rejection of `close()` by issue#99agfr7m, a rebuild after `stop()` would need `close()` first, and JS has no moment of destruction.
- Check only the layout names before `start()`, without binding the names back: it does not find the case "this instance starts first, another instance loads afterwards".
- Only state in the spec that it is the scheduling duty of the caller: the configuration error would still go unfound.

## Decision

Accepted, to be fixed as proposed. Two instances serving blocks of the same name in one scope at the same time is a configuration error, which the emulator should find; `add_ldata` of layout-data 0.7.0 lets `start()` bind the block names back to the layouts, so the names are held for the whole time the services of the emulator run, and this package needs no record of claims of its own.
