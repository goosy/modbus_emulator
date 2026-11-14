---
id: 44nqrsz7
opened: 2026-11-13T18:54:17.248Z
closed: 2026-11-14T02:20:48.000Z
title: Read-only points and a request refusal event
status: fixed       # open | accepted | fixed | rejected | wontfix
labels: []
remote:
---

## Problem

The registers and coils of the emulator are all readable and writable (spec section 3), and a description cannot declare points that are not readable or writable:

- Real devices have holding registers and coils that a master cannot write, such as status areas. The emulator cannot emulate them, and a value a master writes there overwrites the emulated state.
- How a master handles read and write exceptions cannot be tested: a write is never refused, a write to an unmapped address is silently ignored, and a read of one reads 0 / false. Many real devices respond with 0x02 to reads and writes of addresses that do not exist, and the emulator cannot emulate them.
- When a write is refused, the caller has no event to learn of it.
- Responding with 0x02 (Illegal Data Address) to writes of refused registers and coils is a requirement that is not met now.

### Premise

es-modbus issue#bm63kw0g is fixed in es-modbus 0.3.0: when a handler throws an error carrying an allowed `exception_code`, the server responds with that code and does not emit `handler_error`. This package already depends on es-modbus 0.3.0.

## Proposal

### Declaration

The placements of `units[].blocks` take `readonly`, whose value is `none` (the default), `all` or a list of tag names:

```yaml
units:
  - unit_id: 1
    unmapped_write: ignore   # ignore (default) | refuse
    unmapped_read: zero      # zero (default) | refuse
    blocks:
      pump_1: { readonly: all }      # none (default) | all | tag names
      pump_2: { start: 400, readonly: [status, alarm_word] }
```

- `none`: no read-only point, the same as no `readonly`.
- `all`: the whole block is read-only, including the padding bits that belong to no tag.
- Both ends are strings, like the values of `unmapped_read` and `unmapped_write`: not `true` / `false`, because `readonly` tells which points are read-only, the question `all` and a list of tag names answer; not an empty list for no read-only point, because an empty list is most likely left unfilled, and stays a description error. A tag named `all` or `none` is written in a list (`[all]`), which a string cannot be mistaken for.
- A list of tag names: the tags listed are read-only. The list is not empty; a tag name not in the layout is a description error, collected in `errors`; a repeated tag name is a description error.
- When a block is placed only in part by `offset`, a read-only tag in the part not placed is allowed and has no effect.
- Byte ranges or register ranges: not adopted, because people who write the configuration think in tags; offset ranges have to be worked out from the layout and changed whenever the layout changes.

### Granularity

The read-only declarations are compiled at load time into a read-only bit mask of each unit, and at run time the bits a request writes are checked against it:

- With `readonly: all`, all the bits of the block are marked.
- A read-only Bool marks only its own bit; a read-only tag of another type (composite words included, as well as Byte, Int, Real and so on) marks all the bits of the bytes it occupies.
- FC 5/15: if any bit the write reaches is in the mask, the whole request is refused.
- FC 6/16: if any of the 16 bits of any register the write reaches is in the mask, the whole request is refused.
- A refused request writes no point and is answered with 0x02.

This amounts to:

- When a composite word is read-only, all its coupled bits are read-only too.
- Padding bits that belong to no tag are writable (except with `readonly: all`).
- A composite word is writable and one of its coupled bits is read-only: the word cannot be written with FC 6/16, and its other bits can still be written with FC 5/15.
- A composite word is read-only and its coupled bits are listed as well: allowed, not an error (a repeated declaration).
- A read-only tag spanning registers (such as a Real occupying two registers): an FC 16 that writes only one of the registers is refused too.
- A read-only tag and a writable tag share a register: an FC 6/16 write of that register is refused.
- In such a mixed register, the writable tag can still be written with FC 5/15, including several consecutive bits in one FC 15, even across bytes.

### Reads and writes of unmapped addresses

A unit entry gains `unmapped_write`, whose value is `"ignore"` (the default) or `"refuse"`:

- `"ignore"`: as today, the write is ignored and `unmapped` is emitted.
- `"refuse"`: a request that writes any unmapped address of the unit is refused as a whole, writes no point, is answered with 0x02, and emits the event `request_refused`, not the event `unmapped`.

A unit entry gains `unmapped_read`, whose value is `"zero"` (the default) or `"refuse"`:

- `"zero"`: as today, the read reads 0 / false and `unmapped` is emitted.
- `"refuse"`: a request (FC 1/2/3/4) that reads any unmapped address of the unit is refused as a whole, is answered with 0x02, and emits the event `request_refused`, not the event `unmapped`.
- Read-only points are readable as usual and are not concerned.

For both options:

- Always refusing: not adopted, because it changes the current behavior, under which a read or a write across a gap succeeds.
- Two options rather than one `unmapped`: a test often needs to refuse writes only, while the polling of the master keeps succeeding.
- The default for reads is named `"zero"`, not `"allow"`: like `"ignore"`, it names the actual behavior; ignoring a write is also a way of allowing it, and `"allow"` does not tell what is read.

### Event `request_refused`

When the handler refuses a request, it is emitted for each point that causes the refusal, with the same payload as `unmapped`, `{ kind, unit_id, addr, operation }`:

- The points that cause the refusal: the read-only points of a write request, the unmapped points of a write request in a unit with `unmapped_write: "refuse"`, and the unmapped points of a read request in a unit with `unmapped_read: "refuse"`. The other points of the request are not emitted.
- `kind`: the data type, with the same meaning and values as in `unmapped`: `"holding_register"` (FC 3/6/16), `"input_register"` (FC 4) or `"coil"` (FC 1/2/5/15; the handler has no discrete input methods, so es-modbus answers FC 2 with coils).
- `addr`: the address of the point, a register address or a coil address.
- `operation`: `"read"` or `"write"`.
- Deduplicated by (kind, unit_id, addr, operation): each key is emitted once, for at most 1024 keys; after the 1024th key is emitted, `request_refused_limit` (`{ limit }`) is emitted once, and no further `request_refused`.
- A request may hold up to 2000 coils (FC 1/2/15), so a refused one may take many deduplication keys at once and use up the cap quickly; once the cap is used up, only the events stop, and the refusals go on.
- A refused request of the RTU broadcast (unit 0) gets no response, but its write is still refused and the event is still emitted.
- A refusal is normal behavior of the protocol layer and does not emit `handler_error`.
- No reason of the refusal: a point is either mapped and read-only, or unmapped, which the caller tells apart with `unit_map.resolve`.
- Emitting per request (with the start address and the quantity of the request in the payload): not adopted, because a request may meet both read-only and unmapped points, of which only one reason could be given, and deduplicating by the start address would merge requests with the same start address and different quantities into one, with an unclear meaning. The range of a refused request can be learned from the request frame of `server_receive`.
- Named `write_refused`: not adopted, because what is refused is the Modbus request of the master, while the block (Ldata) stays writable, and `write_refused` reads easily as a refused write of the block; a name without "write" can also serve refused reads later.
- The field is named `operation`: not `method`, because the get_/set_ functions of the handler are already called methods; not `access`, to avoid the name of the `access` event.
- No `tags` field.

### Event `unmapped`

The payload gains `operation` (`"read"` / `"write"`) and becomes `{ kind, unit_id, addr, operation }`. The deduplication key becomes (kind, unit_id, addr, operation): a read and then a write of the same address count twice, sharing the cap of 1024. A new field is not a breaking change.

### Flood suppression

`unmapped` and `request_refused` use the same deduplication implementation, but each counts its own cap of 1024 and emits its own `unmapped_limit` and `request_refused_limit`.

- Their keys never coincide: read-only points are all mapped and never appear in `unmapped`; which of the two an unmapped point emits is decided by the `unmapped_write` and `unmapped_read` of the unit.
- A shared cap: not adopted, because unmapped reads during a master's scan easily use up the 1024 first, after which refusals could no longer be seen; a shared cap would also need a `_limit` event name common to both.

## Decision

Accepted. Real devices have points that cannot be written, and some respond with 0x02 to reads and writes of addresses that do not exist; the emulator should be able to emulate them, and how a master handles these exceptions should be testable. es-modbus 0.3.0 already lets a handler specify the exception code, so the premise is met.
