# modbus-emulator Description Specification

> Chinese edition: [spec-descriptions.zh-CN.md](spec-descriptions.zh-CN.md). Keep the two in sync.
>
> This document refines section 5 of [spec.md](spec.md): the descriptions that `load` of `Modbus_Emulator` takes. The sections of spec.md it refers to are the address mapping (spec.md section 3) and the interface (spec.md section 4).

A description is the configuration of an emulator, written as data instead of code. It tells which devices are emulated and how a master reaches them:

- the data of each kind of device: its layout, the names, types, positions and initial values of its tags, like the point table of the device;
- the data blocks: the instances of the layouts, each one piece of concrete data; the data of a device may be made of one or more blocks;
- the units: the slave addresses that serve the blocks, where each block lies in the registers and coils of its unit, the byte order of the device, and which points are read-only;
- the services: the transports (Modbus TCP, UDP, RTU and their variants) with their ports.

`load` reads descriptions and builds the blocks, the units and the services from them, so an emulator is set up without writing the address mapping in code: a user edits a description file, and a program can generate a description. The caller then works only on the blocks, through Ldata / Ltag, to emulate the behavior of the devices. A layout is written once and used by any number of blocks, and its tags are named as the fields of the device data, so the emulator, the master side and the code that emulates the device all speak of the same tags.

## 1. Form and Sources

A description of this package is a description of layout-data with the root keys `units` and `servers` of this package. It is written in a YAML 1.2 file or text (JSON is YAML 1.2 too) and compiled by `desc_file` (a description file) or `yaml` (YAML text), both forwarded by this package. Section 2 summarizes the part of layout-data; its full rules are in [spec-description](https://github.com/goosy/layout-data/blob/main/doc/spec-description.md) of layout-data.

A description has four parts: the layouts and their item tables, the blocks, the units and the services (section 3).

- The parts may be spread over several sources (the `sources` list of one `load`): the `blocks`, the `units` and the `servers` of the sources are joined in the order of the list, and all the descriptions are loaded together into the scope. With several sources an error of this package is prefixed by the source: the path of a description file, or `description #N` for a `Description`, the name layout-data gives an item of a list.
- The `blocks`, the `units` and the `servers` may each be omitted, but a load gives at least blocks or servers.
- The entries are numbered after the ones of the earlier loads, so that `blocks[i]`, `units[i]` and `servers[i]` are the places of the entries in the emulator.
- A description is self-contained: a block names a layout listed by the `layouts` of its own description, whose item tables may come from the files of `imports`, and a unit places blocks of its own description. A description names no scope (spec.md section 4).

## 2. The Part of layout-data

layout-data reads four root keys, and ignores the others:

- `imports`: a list of the paths of the description files whose item tables this description uses. A relative path is relative to the directory of the description file; YAML text has no file, so its `imports` take absolute paths or `file:` URLs. An imported description gives item tables only: its `layouts` and `blocks` are ignored. Imports may be transitive, and may not form a cycle.
- `layouts`: a list of layout names, each a JavaScript identifier, with no name twice. Each name is an item table, compiled into the layout of that name.
- `item_tables`: a mapping from item table names to item tables. An item table is a list of items; it is listed as a layout by `layouts`, or referenced by name by other items, or both.
- `blocks`: a list of blocks, of whose entries layout-data reads `name`, the block name, unique in the description, and `layout`, a layout name listed by `layouts` of the same description. The Ldata of a block is created when the description is loaded, in the scope it is loaded into.

An item is a tag item or an include item:

| Item | Fields |
| --- | --- |
| Tag item | `name`, `type` and `offset` are required; `length`, `init_value`, `comment`, `coupling` and `is_combined` are optional |
| Include item | `includes` and `offset` are required; `name_prefix` is optional |

- `name` is the tag name, an identifier, unique in the layout.
- `type` is one of `Bool`, `Byte`, `SInt`, `USInt`, `Int`, `UInt`, `Word`, `DInt`, `UDInt`, `DWord` and `Real`, case-insensitive.
- `offset` is a bit offset. A tag other than a Bool starts on a whole byte, and a multi-byte tag on an even byte. `length` is in bits and, when written, matches the type.
- `init_value` is the initial value, representable by the type; without it the tag starts at 0 (`false` for a Bool).
- `coupling` makes a combined word: a word whose bits are the Bool items of an item table, named or inline, at offsets relative to the word; the word and its bits share their data. Only one of the two sides gives initial values.
- `includes` splices in the items of an item table, named or inline, shifted as a whole by `offset`, their names prefixed by `name_prefix`.

The item tables reached from `layouts` through `includes` and `coupling` are looked up in the description and in the descriptions it imports, and each must be defined in exactly one of them; the others are not read. In a layout, the byte ranges of tags other than Bools do not overlap, each bit belongs to one Bool at most, a Bool inside another tag is a bit of its combined word, and the total length is a whole number of registers (a multiple of 16 bits).

`desc_file` and `yaml` do all this checking when they compile a description, and throw an `Error` whose `errors` property lists the violations. The result, a `Description`, holds the compiled layouts and keeps the other root keys as they were written, `units` and `servers` included, which this package reads from it.

## 3. Example

```yaml
# 1. layouts and item tables, in the format of layout-data
layouts: [PUMP]
item_tables:
  PUMP:
    - { name: id, type: UInt, offset: 0, init_value: 7 }
    - { name: pressure, type: Real, offset: 16, init_value: 1.5 }

# 2. the blocks, in the format of layout-data
blocks:
  - { name: pump_1, layout: PUMP }
  - { name: pump_2, layout: PUMP }
  - { name: pump_3, layout: PUMP }

# 3. the units: the byte order of the device and the placement of its blocks
units:
  - unit_id: 1                     # 0..255
    endian: LE                     # BE (default), LE, BEBS or LEBS
    unmapped_read: zero            # zero (default) | refuse
    unmapped_write: ignore         # ignore (default) | refuse
    blocks:
      pump_1: {}
      pump_2: { start: 400, readonly: [pressure] }  # start: byte offset in the unit, even; readonly: none (default) | all | tag names
  - unit_id: 3
    blocks:
      pump_3: { offset: 2 }        # offset: start byte inside the block, even

# 4. the services
servers:
  - { protocol: tcp, host: 0.0.0.0, port: 502 }
  - { protocol: rtu_over_tcp, port: 503 }
  - { protocol: udp, port: 502 }
  - { protocol: rtu, port: COM3, baud_rate: 9600, parity: none }
```

## 4. Blocks

- A block entry only defines a block and has no key of this package: where a block is served, and the properties of the device that serves it, are written in the unit entries.
- `blocks[].name` is required, a string not used by another block of its layout (layout-data) nor by a block of the emulator. `blocks[].layout` is a layout name of the same description.
- A block entry has only the keys `name` and `layout`. Another key is an error.

## 5. Units

- `units[].unit_id` is required, an integer from 0 to 255, not used by another unit entry of the load nor by a unit of an earlier load: a unit is declared in one load, and does not change once loaded.
- `units[].endian` (optional) is the byte order of the unit, `BE`, `LE`, `BEBS` or `LEBS`, `BE` by default (spec.md section 3).
- `units[].unmapped_read` (optional) is `zero` (the default) or `refuse`, and `units[].unmapped_write` (optional) is `ignore` (the default) or `refuse`: how the unit answers the reads and the writes of its unmapped addresses (spec.md section 3).
- `units[].blocks` is required, a non-empty object from block names to placements. A placement has the optional `start`, the byte of the unit where the block starts, and `offset`, the byte of the block from which it is served, both even non-negative integers, 0 by default, `offset` below the size of the block, so that a placement serves at least one register; `{}` places a block at byte 0 of the unit, from its first byte. The byte ranges of the blocks of one unit may not overlap.
- A placement may have `readonly` (spec.md section 3): `none` (the default), `all` for the whole block, padding included, or a non-empty list of tag names of the layout of the block, read-only. A name that the layout does not have, or a name given twice, is an error. Listing a composite word and its coupled bits is allowed. A read-only tag outside the part a placement serves (before its `offset`) has no effect.
  - The read-only points are declared by tag, not by byte or register ranges: the people who write descriptions think in tags, and ranges would be worked out from the layout and changed with it.
- Each block of a description must be placed by a unit entry of the same description, and only once: a block placed by none, placed twice, or placed by a unit entry of another description is an error.
- A unit entry has only `unit_id`, `endian`, `unmapped_read`, `unmapped_write` and `blocks`, and a placement only `start`, `offset` and `readonly`. Another key is an error.

## 6. Services

- `servers[].protocol` is one of `tcp`, `rtu_over_tcp`, `udp`, `rtu_over_udp`, `rtu`.
- For `tcp`, `rtu_over_tcp`, `udp` and `rtu_over_udp`, `host` defaults to `0.0.0.0` and `port` to 502; `port` is an integer from 1 to 65535 (es-modbus does not accept port 0).
- For `rtu`, `port` is the serial port path, with optional `baud_rate` (a positive integer, default 9600), `parity` (`none`, `odd` or `even`, default `none`), `data_bits` (5, 6, 7 or 8, default 8) and `stop_bits` (1, 1.5 or 2, default 1).
- Two `tcp` / `rtu_over_tcp` services may not use the same `host` and `port`, and neither may two `udp` / `rtu_over_udp` services; services on different hosts may use the same port. TCP and UDP ports are apart: a `tcp` or `rtu_over_tcp` service and a `udp` or `rtu_over_udp` service may use the same `host` and `port`. Two `rtu` services may not use the same serial port path.
- `servers[].unit_ids` (optional) are the unit ids the service answers: a non-empty list of integers from 0 to 255, each of which must be a unit of the emulator once loaded. By default the service answers all units, including the units of later loads.
- All services share one unit map and the same data blocks. `unit_ids` only decides which units each service answers.
- A service entry has only `protocol`, `unit_ids`, and `host`, `port` for `tcp` / `rtu_over_tcp` / `udp` / `rtu_over_udp`, or `port`, `baud_rate`, `parity`, `data_bits`, `stop_bits` for `rtu`. Another key is an error.

## 7. Root Keys and Layout Files

- The root keys are not checked: a key other than `imports`, `layouts`, `item_tables`, `blocks`, `units` and `servers` is not used, so it may hold anything the caller needs.
- The item tables may be kept out of a description, which imports them with `imports` and lists its layouts under `layouts`. A layout file is also an item of the `sources` list like the others: all the sources are loaded together, and the descriptions that list a layout of the same name and structure share it.
