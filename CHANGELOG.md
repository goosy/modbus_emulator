# Changelog

## v0.3.1 - 2026-11-17

### Features

- **Modbus UDP and RTU over UDP.** `create_udp_server(unit_map, options)` creates a Modbus UDP server, or RTU over UDP with `rtu: true`, with the options of `create_tcp_server`. A description takes the protocols `udp` and `rtu_over_udp`, with the keys of `tcp`. UDP ports are checked apart from the TCP ones, a `udp` service gets no serial bus warning, and the services are labeled `modbus+udp://` and `rtu+udp://`.
- **Requires es-modbus 0.3.2 and layout-data 0.7.0.**

### Fixes

- **The emulator holds its block names whenever its services run.** `start()` binds the names given back by `stop()` to their layouts again, and a failed start gives none back. When a layout holds the name of a block for another Ldata, `start()` rejects with an `Error` whose `errors` lists every conflicting block, and starts no service.
- **A listener error of an FC 6 / FC 5 write is reported as `listener_error`.** It was thrown to es-modbus, which answered exception 0x04 although the point was written; the write is now committed like FC 16 / FC 15, and the master gets a normal response.
- **`Unit_Map#attach_unit` checks the unit id**: an id that is not an integer from 0 to 255 throws a `RangeError`, as in `set_endian` and `set_unmapped_*`.
- **A hand-built `Description` whose block entry is not a mapping or names no layout of its `layouts`** is reported as not a `Description` by `load`, instead of throwing a `TypeError`.

## v0.3.1 - 2026-11-17 (中文)

### 功能

- **Modbus UDP 和 RTU over UDP。** `create_udp_server(unit_map, options)` 创建 Modbus UDP 服务，`rtu: true` 时为 RTU over UDP，选项与 `create_tcp_server` 相同。描述可以使用协议 `udp` 和 `rtu_over_udp`，键与 `tcp` 相同。UDP 端口与 TCP 端口分开检查，`udp` 服务不产生串行总线警告，服务的标签为 `modbus+udp://` 和 `rtu+udp://`。
- **要求 es-modbus 0.3.2 和 layout-data 0.7.0。**

### 修复

- **服务运行期间，模拟器始终持有其数据块名。** `start()` 把 `stop()` 交还的块名重新绑定到各自的布局，启动失败时不交还任何块名。某个布局把数据块的名字留给了另一个 Ldata 时，`start()` 以 `Error` 拒绝，其 `errors` 列出全部冲突的数据块，且不启动任何服务。
- **FC 6 / FC 5 写入时监听器抛出的异常作为 `listener_error` 报告。** 以前它被抛给 es-modbus，主站收到异常码 0x04，而数据已经写入；现在单点写与 FC 16 / FC 15 一样提交，主站照常收到应答。
- **`Unit_Map#attach_unit` 检查单元号**：不是 0 到 255 的整数时抛出 `RangeError`，与 `set_endian`、`set_unmapped_*` 一致。
- **手工构造的 `Description` 中数据块条目不是映射，或引用的布局不在其 `layouts` 中时**，`load` 报告它不是 `Description`，而不再抛出 `TypeError`。

## v0.3.0 - 2026-11-14

### Breaking changes

- **Requires es-modbus 0.3.0.** A TCP port is from 1 to 65535: port 0 is rejected by `create_tcp_server` (a `RangeError`) and in the servers of a description, and is no longer exempt from the check of ports used twice. `Modbus_Server` declares `host`; `host` and `port` are null for an `rtu` server.
- **Blocks are placed by unit entries.** A description gets the root key `units`; block entries keep only `name` and `layout`, and no longer take `unit_id`, `start` and `offset`. A unit entry stands for a device and places blocks of its own description with `start` and `offset`; every block of a description is placed once by one of its units, and a unit is declared by one `load` only.
- **`Unit_Map#attach_unit` takes an options object**: `attach_unit(unit_id, block, { start, offset, readonly })`.
- **`unmapped` is emitted only for a request that succeeds**, once per (kind, unit, address, operation), and carries `operation` (`read` or `write`).

### Features

- **Byte order of a unit.** A unit entry gives the byte order of its device with `endian` (`BE` by default, `LE`, `BEBS` or `LEBS`). The blocks stay big-endian, and the unit serves the IO buffer of each block in its byte order. `Unit_Map` gets `set_endian` and `get_endian`.
- **Read-only points.** A placement takes `readonly`: `none` (the default), `all`, or a list of tag names. A write of FC 5 / 15 that reaches a read-only bit, or of FC 6 / 16 that reaches a register with a read-only bit, is refused as a whole with exception 0x02 and writes nothing.
- **Refusing unmapped addresses.** A unit entry takes `unmapped_read` (`zero` or `refuse`) and `unmapped_write` (`ignore` or `refuse`); with `refuse`, a request that reaches an unmapped address of the unit is answered with exception 0x02. `Unit_Map` gets `set_unmapped_read`, `set_unmapped_write` and their getters.
- **`request_refused` event.** The handler emits it for each point that causes a refusal, with the payload of `unmapped`, capped at 1024 keys and then `request_refused_limit` once; the emulator forwards it.

### Fixes

- **A placement `offset` must be below the size of its block.** Such a placement served no byte and gave a segment whose end was not above its start; `attach_unit` now throws a `RangeError`, and a description reports the error.

## v0.3.0 - 2026-11-14 (中文)

### 不兼容变更

- **要求 es-modbus 0.3.0。** TCP 端口取 1 到 65535：`create_tcp_server` 拒绝端口 0（抛出 `RangeError`），描述的服务中也不接受端口 0，端口 0 不再免于端口重复的检查。`Modbus_Server` 声明了 `host`；`rtu` 服务的 `host` 和 `port` 为 null。
- **数据块由单元条目放置。** 描述增加根键 `units`；数据块条目只保留 `name` 和 `layout`，不再接受 `unit_id`、`start` 和 `offset`。单元条目代表一台设备，用 `start` 和 `offset` 放置本描述中的数据块；描述中的每个数据块都由它的某个单元放置一次，一个单元只能由一次 `load` 声明。
- **`Unit_Map#attach_unit` 改用选项对象**：`attach_unit(unit_id, block, { start, offset, readonly })`。
- **`unmapped` 只对成功的请求发出**，每个（类别、单元、地址、操作）一次，并带有 `operation`（`read` 或 `write`）。

### 功能

- **单元的字节序。** 单元条目用 `endian` 给出设备的字节序（默认 `BE`，还有 `LE`、`BEBS`、`LEBS`）。数据块仍为大端，单元按自己的字节序提供每个数据块的 IO 缓冲区。`Unit_Map` 增加 `set_endian` 和 `get_endian`。
- **只读点。** 放置可以带 `readonly`：`none`（默认）、`all` 或 tag 名列表。FC 5 / 15 写到只读位，或 FC 6 / 16 写到含只读位的寄存器时，整个请求被拒绝，应答异常 0x02，不写入任何内容。
- **拒绝未映射地址。** 单元条目可以带 `unmapped_read`（`zero` 或 `refuse`）和 `unmapped_write`（`ignore` 或 `refuse`）；取 `refuse` 时，触及该单元未映射地址的请求应答异常 0x02。`Unit_Map` 增加 `set_unmapped_read`、`set_unmapped_write` 及相应的取值方法。
- **`request_refused` 事件。** handler 为每个导致拒绝的点发出该事件，内容与 `unmapped` 相同，上限 1024 个键，之后发出一次 `request_refused_limit`；模拟器转发它。

### 修复

- **放置的 `offset` 须小于数据块大小。** 这样的放置不提供任何字节，得到的段终点不大于起点；现在 `attach_unit` 抛出 `RangeError`，描述中则报告该错误。

## v0.2.0

### Breaking changes

- **Requires layout-data 0.6.0.** Layouts live in layout-data scopes instead of one registration per process. A description follows the format of layout-data 0.6.0: it lists its layout names under `layouts`, holds the item tables under `item_tables`, and takes item tables of other files with `imports`; the root key `layouts_file` is dropped.
- **Construction and loading are separate.** `new Modbus_Emulator(source)` is replaced by `new Modbus_Emulator(scope)`, which only creates the emulator, with the name of the layout scope it loads into (`modbus_emulator` by default, created when it does not exist), so several emulators can live in one process. `emulator.load(sources)` loads descriptions any number of times and returns the `{ blocks, servers }` it added. A source is a description file (a path or a `file:` URL) or a `Description` compiled by the caller with `desc_file` or `yaml`; the former plain-object entry is dropped.
- **Diagnostics of a load are `warning` events**; the `warnings` array is removed.
- **The forwarded layout-data API** is now `Ldata`, `Ltag`, `create_scope`, `get_scope`, `yaml` and `desc_file`; `register_layout`, `get_layout`, `io_index_table` and `render_types` are removed, as layout lookup, ldata creation and `io_index_table` are methods of a scope or a layout. The emulator exposes its `scope`.

### Features

- **All-or-nothing loads.** Every check comes before anything is loaded, including the block overlaps, the ports and the `unit_ids`, checked against the earlier loads, so a failed load changes neither the emulator nor the scope. A service without `unit_ids` also answers the units of later loads.
- **Restartable.** `stop()` gives the block names back to their layouts, so the same description can be loaded again in the scope once the emulator stopped; the blocks keep working, and `start()` serves them again. `start()` starts only the services that are not running.

### Fixes

- A single-coil read (FC 1 with quantity 1) emits an `access` that names only the coil read, not every Bool of its byte.

### Artifacts

- Published as a bundle (`dist/index.js`) with its type declarations; `layout-data` and `es-modbus` are not bundled and stay as imports. The direct dependency on `yaml` is dropped.

## v0.2.0 (中文)

### 不兼容变更

- **要求 layout-data 0.6.0。** 布局存放在 layout-data 的登记域中，不再是每个进程一次性登记。描述采用 layout-data 0.6.0 的格式：在 `layouts` 下列出布局名，在 `item_tables` 下给出条目表，用 `imports` 引用其他文件的条目表；根键 `layouts_file` 被取消。
- **构造与装入分离。** `new Modbus_Emulator(source)` 改为 `new Modbus_Emulator(scope)`，只创建模拟器，参数是它装入描述所用的布局登记域名（默认 `modbus_emulator`，不存在时创建），因此一个进程中可以有多个模拟器。`emulator.load(sources)` 可多次装入描述，返回本次新增的 `{ blocks, servers }`。来源是描述文件（路径或 `file:` URL），或由调用方用 `desc_file`、`yaml` 编译的 `Description`；原先的普通对象入口被取消。
- **装入的诊断改为 `warning` 事件**；`warnings` 数组被移除。
- **转发的 layout-data 接口** 改为 `Ldata`、`Ltag`、`create_scope`、`get_scope`、`yaml` 和 `desc_file`；`register_layout`、`get_layout`、`io_index_table` 和 `render_types` 被移除，因为查找布局、创建 ldata 和 `io_index_table` 都已是登记域或布局的方法。模拟器提供其 `scope`。

### 功能

- **装入要么全部成功、要么不生效。** 所有检查都在装入之前完成，包括数据块重叠、端口和 `unit_ids`，并与之前的装入一起核对；装入失败时模拟器和登记域都保持原样。未给 `unit_ids` 的服务也应答之后装入的单元。
- **可重新启动。** `stop()` 把数据块名交还给它们的布局，模拟器停止后，同一描述可以在该登记域中再次装入；数据块仍可使用，`start()` 会重新对外提供它们。`start()` 只启动尚未运行的服务。

### 修复

- 读单个线圈（数量为 1 的 FC 1）发出的 `access` 只列出被读的线圈，不再列出同一字节中的所有 Bool。

### 产物

- 以打包文件（`dist/index.js`）及其类型声明发布；`layout-data` 和 `es-modbus` 不打包，保持为 import。不再直接依赖 `yaml`。

## v0.1.0

First release.

### Features

- **Modbus slave services over data blocks.** Modbus TCP, RTU over TCP and RTU (serial port) slaves serve named data blocks (`Ldata` of [layout-data](https://github.com/goosy/layout-data)), and several services can share the same blocks. Register `addr` is byte `addr * 2` of a unit, big-endian; coil `addr` is bit `addr % 8` of byte `addr >> 3`; holding and input registers share the same content. Writes from the master go through `Ldata`, so the `change` and `write` events of a block fire as usual.
- **`Modbus_Emulator(source)`** builds the blocks, the unit map and the services from one or several YAML description files, validated as a whole: an invalid description throws an `Error` whose `errors` lists every violation. `start()` is all or nothing by default, `start({ partial: true })` keeps the services that started, and a failure rejects with an `AggregateError` naming each failed service. Its properties (`blocks`, `layouts`, `servers`, `unit_map`, `handler`, `warnings`) are read-only.
- **Assembly in code.** `Unit_Map` places blocks at even byte offsets of a unit and rejects overlapping blocks; `create_handler`, `create_tcp_server(unit_map, options)` and `create_rtu_server(path, unit_map, options)` build the handler and the services for callers without a description file.
- **Request semantics.** An FC 16 / FC 15 request is written atomically: each block it reaches is written once, and a failure midway restores them all and answers exception 0x04. A read emits one `access` per block, naming only the tags read. An unmapped address reads as 0 / false and ignores writes.
- **Diagnostics as events.** The package outputs nothing itself: the handler emits `unmapped` (once per address, capped at 1024, then `unmapped_limit`) and `listener_error`, the emulator forwards them and the server events as `server_<name>`, and the diagnostics found at construction, such as a broadcast or reserved unit served on a serial bus, are in `warnings`.
- **Forwarded layout-data API.** `Ldata`, `Ltag`, `register_layout`, `get_layout`, `io_index_table`, `render_types` and their types are forwarded, so the process holds one copy of layout-data.
- **Artifacts.** ESM source as is, for Node.js >= 20.11, with hand-written type declarations. MPL-2.0.

## v0.1.0 (中文)

首个发布版本。

### 功能

- **基于数据块的 Modbus 从站服务。** Modbus TCP、RTU over TCP 和 RTU（串口）从站对外提供具名数据块（[layout-data](https://github.com/goosy/layout-data) 的 `Ldata`），多个服务可共享同一组数据块。寄存器 `addr` 对应单元的第 `addr * 2` 字节，大端；线圈 `addr` 对应第 `addr >> 3` 字节的第 `addr % 8` 位；保持寄存器与输入寄存器内容相同。主站的写入经由 `Ldata`，所以数据块的 `change`、`write` 事件照常触发。
- **`Modbus_Emulator(source)`** 由一个或多个 YAML 描述文件构建数据块、单元映射和服务，描述作为整体校验：描述无效时抛出 `Error`，其 `errors` 列出全部违规。`start()` 默认要么全部启动、要么都不启动，`start({ partial: true })` 保留已启动的服务；失败时以 `AggregateError` 拒绝，逐一指明失败的服务。其属性（`blocks`、`layouts`、`servers`、`unit_map`、`handler`、`warnings`）只读。
- **在代码中组装。** `Unit_Map` 把数据块放到单元的偶数字节偏移处，并拒绝相互重叠的数据块；`create_handler`、`create_tcp_server(unit_map, options)` 和 `create_rtu_server(path, unit_map, options)` 供不用描述文件的调用方构建 handler 和服务。
- **请求语义。** FC 16 / FC 15 请求原子写入：所触及的每个数据块只写一次，中途失败时全部恢复并应答异常 0x04。读请求对每个数据块发出一次 `access`，只列出被读的 tag。未映射的地址读为 0 / false，写入被忽略。
- **以事件报告诊断。** 本包自身不输出任何内容：handler 发出 `unmapped`（每个地址一次，上限 1024 个，之后发出一次 `unmapped_limit`）和 `listener_error`，模拟器转发它们，并把服务的事件转发为 `server_<name>`；构造时发现的诊断（例如串行总线上应答广播或保留单元）放在 `warnings` 中。
- **转发 layout-data 的 API。** 转发 `Ldata`、`Ltag`、`register_layout`、`get_layout`、`io_index_table`、`render_types` 及相应类型，使进程中只有一份 layout-data。
- **产物。** 原样的 ESM 源码，要求 Node.js >= 20.11，附手写的类型声明。MPL-2.0。
