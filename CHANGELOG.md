# Changelog

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
