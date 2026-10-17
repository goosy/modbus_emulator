# modbus_emulator Specification

> Chinese edition: [spec.zh-CN.md](spec.zh-CN.md). Keep the two in sync.

## 1. Goals and Scope

modbus_emulator is a Modbus device emulator library. It provides Modbus slave services to the outside, and exposes the data through the Ldata / Ltag API of [layout-data](https://github.com/goosy/layout-data/blob/main/doc/spec-data-api.md), so that callers can apply extra computation to emulate the running of a device.

- Slave transports: Modbus TCP, RTU over TCP, RTU (serial port).
- One emulator can provide several services at the same time, sharing the same set of data blocks.
- It is published as a library. A controller or similar program can use its server part to publish its own data blocks to a host (HMI/SCADA).

Out of scope: the Modbus master (client), the business logic of a device (implemented by the caller through Ldata), and the concrete logger (injected by the caller).

## 2. Terms

| Term | Meaning |
| --- | --- |
| Block | A named data block (Ldata), laid out in bytes and attached to a byte offset of a unit |
| Unit | A slave address identified by a unit id, which usually stands for one device or a group of process values. A unit can hold several blocks, each in a different byte range |
| Unit map (`Unit_Map`) | The mapping from unit ids to blocks and their byte ranges |

## 3. Address Mapping

- Layouts and data blocks are static. The description file is read once at construction. After the blocks (Ldata) and the unit map are built, none is added or removed and no layout changes. A running service cares only about the values, and does not handle changes of the data blocks.

- Register `addr` corresponds to byte `addr * 2` of the unit. The content of the block is read and written in big-endian.
- Coil `addr` corresponds to bit `addr % 8` of byte `addr >> 3`.
- Holding registers and input registers have the same content. Registers and coils are readable and writable.
- Writes go through the write methods of Ldata, so the `change` and `write` events of the block fire as usual.
- An address in a unit with no block reads as 0 / false, and a write to it is ignored. No exception is returned, so a read across a gap still succeeds. A warning is reported once per (type, unit, address).
- An unregistered unit id is answered with exception code 0x0B by es-modbus. An illegal function code, an illegal quantity, or an address out of range is answered with 0x01 / 0x03 / 0x02.

## 4. Interface

- `Modbus_Emulator(source, options)`: the main constructor. `source` is the path of a description file (section 5), or a list of paths: the files are read together as one description. It builds the blocks and the services.
  - `blocks`: a map from block names to Ldata. `block(name)` gets one block. `unit_map`: the unit map. `servers`: the server instances. `layouts`: the registered layouts by name (read-only). `vector`: the vector shared by all the servers.
  - `start()` / `stop()`: start / stop all services.
  - An invalid description file throws an `Error` whose `errors` property lists all violations.
- `create_tcp_server(host, port, unit_map, { rtu, unit_ids, vector, logger })`: creates a Modbus TCP service. `host` defaults to `0.0.0.0` and `port` to 502; `unit_map` is required. With `rtu: true` it uses RTU frames on the TCP socket (RTU over TCP). It returns the es-modbus `Modbus_Server`, not started.
- `create_rtu_server(path, unit_map, { baud_rate, parity, data_bits, stop_bits, unit_ids, vector, logger })`: creates an RTU slave on a serial port. `unit_map` is required. The defaults are 9600, `none`, 8 and 1 for `baud_rate`, `parity`, `data_bits` and `stop_bits`. It returns a `Modbus_Server`, and the port is opened only at `start()`.
- `unit_ids`: optional, the unit ids a service answers. It defaults to all the units of `unit_map`. A unit id outside the list is answered with exception code 0x0B by es-modbus.
- `vector`: optional, the vector to serve (the result of `create_vector`). Servers of one unit map can share one. By default it is built from the unit map.
- `Unit_Map` / `create_vector(unit_map, { logger })`: the unit map and the es-modbus server vector, for callers that do not use a description file (such as a controller) and assemble things themselves.
- `Ldata`, `Ltag`, `register_layout`, `get_layout`, `io_index_table`, `render_types` and the types of layout-data that go with them (`Layout`, `Layout_Tag`, `Layout_Item`, `Tag_Item`, `Include_Item`, `Layout_Description`, `Layout_Source`, `Registered_Layouts`, `Endian`, `Tag_Type`): the API of [layout-data](https://github.com/goosy/layout-data/blob/main/doc/spec-data-api.md) that callers use, forwarded as it is. The blocks are `Ldata` objects, so this package is the one place the callers take this API from: they do not depend on layout-data themselves, and the process has one copy of it, which `register_layout` needs (it succeeds once per process). The forwarded API follows the version of layout-data this package depends on.
- `logger`: optional, with `info` / `warn` / `error` methods. When it is absent, or a method is missing, nothing is output.

## 5. Description File

A YAML 1.2 file with three parts. The parts may also be spread over several files (the `source` list): the `blocks` and the `servers` of the files are joined in the order of the files, the layouts of all the files are registered together, and an error names its file.

The root keys of a file are `blocks`, `servers`, `layouts_file`, and the layouts and fragments of layout-data (`layouts` and the fragment names). `blocks` and `servers` belong to this package and are not passed to layout-data; the rest are the layout sources.

```yaml
# 1. layouts and fragments, in the format of layout-data
layouts:
  PUMP:
    - { name: id, type: UInt, offset: 0, init_value: 7 }
    - { name: pressure, type: Real, offset: 16, init_value: 1.5 }

# 2. the blocks
blocks:
  - { name: pump_1, unit_id: 1, layout: PUMP }               # unit_id: 0..255
  - { name: pump_2, unit_id: 1, layout: PUMP, start: 400 }   # start: byte offset in the unit, even

# 3. the services
servers:
  - { protocol: tcp, host: 0.0.0.0, port: 502 }
  - { protocol: rtu_over_tcp, port: 503 }
  - { protocol: rtu, port: COM3, baud_rate: 9600, parity: none }
```

- `blocks[].name` defaults to `unit_<unit_id>`, and block names must be unique. `offset` (optional) is the start byte inside the block.
- `servers[].protocol` is one of `tcp`, `rtu_over_tcp`, `rtu`. For `tcp` and `rtu_over_tcp`, `host` defaults to `0.0.0.0` and `port` to 502. For `rtu`, `port` is the serial port path, with optional `baud_rate`, `parity`, `data_bits`, `stop_bits`.
- `servers[].unit_ids` (optional) are the unit ids the service answers: a non-empty list of integers from 0 to 255, each of which must have a block. By default the service answers all units.
- The layouts may be kept out of the description, or split: the root key `layouts_file` names a layout file (relative to the file that names it); `layouts` and fragments may be given as well, and all of them are registered together (a name defined twice is an error). When neither is given, the blocks use the layouts already registered in the process.
- All services share one unit map and the same data blocks. `unit_ids` only decides which units each service answers.

## 6. Distribution

- Published as an ES module library with the entry `modbus_emulator`. It depends on `layout-data`, `es-modbus` and `yaml`, which stay external: the package is meant to be a dependency of other packages, and the application that uses it bundles them once.
- Node.js >= 20.11.
