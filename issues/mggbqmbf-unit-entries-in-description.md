---
id: mggbqmbf
opened: 2026-11-13T02:31:17.676Z
closed: 2026-11-13T08:00:59.000Z
title: Add unit entries to the description and move block placement into them
status: fixed       # open | accepted | fixed | rejected | wontfix
labels: []
remote:
---

## Problem

A unit has no entry of its own in a description: it appears only as a number, in the `unit_id` of block entries and the `unit_ids` of service entries. Which unit a block goes to, and where, is written on the block entry:

```yaml
blocks:
  - { name: pump_1, unit_id: 1, layout: PUMP }
  - { name: pump_2, unit_id: 1, layout: PUMP, start: 400 }
```

- Block entries are shared by layout-data and this package: layout-data reads only `name` and `layout`, and `unit_id`, `start`, `offset` are keys of this package kept in the entries of layout-data, so the responsibilities of the two packages over the description are not clear.
- The data areas of a unit are scattered over the block entries: to know which blocks a unit has and where each one is, one has to pick out the block entries with the same `unit_id`, and an overlap is hard to see.
- A unit has no place for the properties of a device. The byte order is such a property (see "device byte order of a block" in `.local/TODO.md`, requested by the actuator emulator of TLMS_ESD.js, its issue#a6d39veq):
  - The byte order belongs to the device, that is the unit. Many OT programs also require the byte order to be configured per unit (slave).
  - The only place available now is the block entry, which would let the blocks of one unit each use a byte order. Mixing byte orders in one unit is a defect of a device, and declaring it per block encourages writing it that way.
  - The emulator instance and the service are both wrong: an instance usually emulates several devices; a service answers several units, and one unit can be reached through several services.

## Proposal

Add the root key `units`, a list of unit entries. A block entry only defines a block, with only the `name` and `layout` of layout-data; the placement of the blocks and the properties of the device are written in the unit entry:

```yaml
blocks:   # only define the blocks
  - { name: pump_1, layout: PUMP }
  - { name: pump_2, layout: PUMP }
  - { name: pump_3, layout: PUMP }

units:
  - unit_id: 1
    endian: LE
    blocks:
      pump_1: {}
      pump_2: { start: 400 }
  - unit_id: 3
    endian: BEBS
    blocks:
      pump_3: { start: 0, offset: 16 }
```

- Unit entry: `unit_id` is required, an integer from 0 to 255; `endian` is optional, one of `BE`, `LE`, `BEBS`, `LEBS`, `BE` by default; `blocks` is required, an object from block names to placements, a placement having only `start` and `offset` (with the meaning and constraints of the present block entry).
- The byte order is declared per unit only; a block has no `endian`. The data is served in the byte order of the device, while the content of a block is still kept in big-endian (layout-data keeps one canonical copy of the data); the conversion is done in the handler of this package, which may use `Layout#io_index_table(endian)` of layout-data.
- Service entries are unchanged: `unit_ids` still refers to unit ids.
- The following rules start strict, as relaxing them later does not break compatibility:
  - A block is placed in one place only: in two units, or twice in one unit, is an error.
  - A block defined but placed in no unit is an error.
  - A block referred to by a unit entry must be a block of the same description (a description is self-contained).
  - The same `unit_id` twice in one load is an error; so is a unit already declared by an earlier load (a unit is declared in one load only, and does not change once loaded).
- Block entries lose `unit_id`, `start`, `offset`, and every unit that serves data needs a unit entry: a breaking change.
- Program interfaces such as `Unit_Map` and `create_handler` still attach blocks one by one; the byte order must be settable through the program interface too, in a way decided in the design.

**Rejected alternatives**

- Declaring `endian` on block entries: the granularity is the block, which encourages mixing byte orders in one unit.
- Declaring `endian` on the emulator instance or as a root key of the description: an instance, or a description, usually holds several devices, so the granularity is too coarse.
- Declaring `endian` on service entries: the byte order follows the unit, not the service.
- Making the byte order a property of the Ldata of layout-data: it breaks the premise of layout-data of one canonical copy of the data (the buffer is always big-endian); the byte order is converted only at the IO boundary.
- `units` as an object keyed by unit id: the keys of a JS object are strings, so a unit id loses its number type, the validity of spellings such as `"01"` has to be decided separately, and the place of an error cannot be written as an index like `blocks[i]` and `servers[i]`.

## Decision

The issue holds and is implemented as proposed: a unit is a device, so the properties of the device, such as the byte order, and the placement of the blocks belong to the unit entry; block entries are left to layout-data, which separates the responsibilities of the two packages over the description.
