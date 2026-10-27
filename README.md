# modbus-emulator

A Modbus device emulator library. It provides Modbus slave services (TCP, RTU over TCP, RTU) over structured data blocks, and exposes the data through the Ldata / Ltag API of [layout-data](https://github.com/goosy/layout-data/blob/main/doc/spec-data-api.md), so your code can compute on the data to emulate a running device.

## Features

- Slave transports: Modbus TCP, RTU over TCP, RTU (serial port).
- Several services at once, sharing the same data blocks.
- Blocks are described in YAML (a file or text in code), or assembled in code with `Unit_Map`.
- Writes from the master go through Ldata, so the `change` and `write` events fire as usual.

## Install

```sh
pnpm add modbus-emulator
```

Requires Node.js >= 20.11.

## Usage

### From a description file

```yaml
# plant.yaml
layouts: [PUMP]
item_tables:
  PUMP:
    - { name: id, type: UInt, offset: 0, init_value: 1 }
    - { name: pressure, type: Real, offset: 32, init_value: 1.5 }

blocks:
  - { name: pump_1, unit_id: 1, layout: PUMP }

servers:
  - { protocol: tcp, host: 0.0.0.0, port: 1502 }
```

```js
import { Modbus_Emulator, desc_file } from "modbus-emulator";

const emulator = new Modbus_Emulator(desc_file`plant.yaml`, "plant"); // loaded into the layout-data scope plant
await emulator.start();

const pump = emulator.block("pump_1"); // a Ldata of layout-data
// ... apply your own computation to pump ...

await emulator.stop();
```

The constructor takes compiled descriptions, a `Description` or a list of them: compile a description file with ``desc_file`plant.yaml` `` or YAML text with ``yaml`...` ``, which throw the errors of reading and compiling. An object of the shape of a description is compiled with `yaml(JSON.stringify(object))`. Invalid descriptions throw an `Error`; its `errors` property lists all violations.

A block names a layout of its own description file; the description may take the item tables of another file with `imports: [common.yaml]` and list the layout under `layouts`. The descriptions are loaded into a [layout-data scope](https://github.com/goosy/layout-data/blob/main/doc/spec-layout.md), apart from the layouts of your code and of other libraries. The scope is chosen in code, by the second argument of the constructor, `modbus_emulator` by default, and created when it does not exist. In a scope a layout of the same name and structure is shared, and a layout of the same name and another structure is an error: load such descriptions into another scope. The block names are held by their layouts until `stop()` gives them back, so the same description can be constructed again in a scope once the earlier emulator stopped.

### Without a description file

```js
import { Unit_Map, create_scope, create_tcp_server, yaml } from "modbus-emulator";

const scope = create_scope("plant");
scope.load(yaml`
layouts: [PUMP]
item_tables:
  PUMP:
    - { name: id, type: UInt, offset: 0, init_value: 1 }
    - { name: pressure, type: Real, offset: 32, init_value: 1.5 }
`);
const pump = scope.get_layout("PUMP").create_ldata("pump_1");

const unit_map = new Unit_Map();
unit_map.attach_unit(1, pump, 0, 0);

const server = create_tcp_server(unit_map, { port: 1502 });
await server.start();
```

`load` takes compiled descriptions: read a description file with ``desc_file`pump.yaml` `` or YAML text with ``yaml`...` ``.

Take `Ldata`, `create_scope`, `get_scope`, `yaml` and `desc_file` from this package rather than from layout-data, so that there is one copy of layout-data in the process: two copies share no scope.

`create_rtu_server(path, unit_map, options)` creates an RTU slave on a serial port. `create_handler(unit_map)` returns the es-modbus server handler for fully custom assembly. The factories add no listener: listen to `error` of each server, which throws when it has no listener.

### Events

The package outputs nothing itself and reports through events:

```js
emulator.on("server_start", ({ server }) => console.log(`${server.name} started`));
emulator.on("server_error", ({ server, error }) => console.error(`${server.name}: ${error.message}`));
emulator.on("unmapped", ({ kind, unit_id, addr }) => console.warn(`unmapped ${kind} ${addr} in unit ${unit_id}`));
```

- The emulator forwards each event `<name>` of its servers as `server_<name>` with `{ server }` and the argument of the event (`socket`, `error` or `frame`); `server.name` is the label of the service, such as `servers[0] (modbus://0.0.0.0:1502)`.
- The handler emits `unmapped` once per unmapped address (at most 1024, then `unmapped_limit` once) and `listener_error` when a block listener throws; the emulator forwards them.
- The emulator always listens to `error` of its servers and never emits `error`, so it never throws from an event.
- Diagnostics found at construction are in `emulator.warnings`.

## Address mapping

- Register `addr` is byte `addr * 2` of the unit, big-endian. Holding and input registers share the same content.
- Coil `addr` is bit `addr % 8` of byte `addr >> 3`.
- Addresses with no block read as 0 / false and ignore writes (warned once per address).

See [doc/spec.md](doc/spec.md) for the full specification and [doc/design.md](doc/design.md) for the implementation. Chinese editions: [doc/spec.zh-CN.md](doc/spec.zh-CN.md), [doc/design.zh-CN.md](doc/design.zh-CN.md).

## Development

```sh
pnpm install
pnpm test
pnpm lint
```

## License

MPL-2.0
