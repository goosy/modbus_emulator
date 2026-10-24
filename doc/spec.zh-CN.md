# modbus_emulator 规范

## 1. 目标与范围

modbus_emulator 是一个 Modbus 设备模拟器库：对外提供 Modbus 从站服务，并通过 [layout-data](https://github.com/goosy/layout-data/blob/main/doc/spec-data-api.md) 的 Ldata / Ltag 对外提供操作 API，使调用方可以施加额外的运算，模拟一个数据块的运行。

- 从站服务的传输：Modbus TCP、RTU over TCP、RTU（串口）；
- 同一个模拟器可以同时提供多个服务，共用同一组数据块；
- 以库的形式发布；控制器等程序可以用它的服务端部分，向上位机（HMI/SCADA）发布自己的数据块。

不在范围内：Modbus 主站（客户端）、设备的业务逻辑（由调用方通过 Ldata 实现）、诊断信息的输出（本包发出事件，由调用方决定如何处理）。

## 2. 术语

| 术语 | 含义 |
| --- | --- |
| 数据块（block） | 一个具名的数据块（Ldata），按布局存放，挂在某个单元号的某个字节偏移处 |
| 单元（unit） | 以单元号（unit id）区分的一个从站地址，通常代表一台设备或一组过程量；一个单元可以挂多个数据块，各占不同的字节区间 |
| 单元表（Unit_Map） | 单元号到数据块及其字节区间的映射 |

## 3. 地址映射

- 布局和数据块是静态的：描述文件在构造时一次读入，数据块（Ldata）和单元表建好后不再增删或改变布局；运行中的服务只关心数值，不处理数据块的变更；

- 寄存器 `addr` 对应单元内的字节 `addr * 2`，按大端读写数据块的内容；
- 线圈 `addr` 对应字节 `addr >> 3` 的第 `addr % 8` 位；
- 保持寄存器与输入寄存器内容相同；寄存器和线圈可读写；
- 写入经 Ldata 的写入方法完成，因此数据块的 `change` 和 `write` 事件照常触发；
- 一次 FC 16 / FC 15 请求是原子的：对写到的每个块写入一次，发出一次 `write` 和一次 `write` 类的 `access`；写入中途失败时，涉及的块全部恢复，主站收到异常码 0x04。FC 6 / FC 5 写一个点。这由 handler 完成，所以用 `create_handler` 自行装配的服务行为相同；
- 一次读请求对读到的每个块发出一次 `read` 类的 `access`，只报告被读的 tag；线圈只报告被读的位所对应的 Bool；
- 提交一次请求时，块的监听器（`change`、`write`、`access`）抛出的异常既不撤销写入，也不影响其他块：主站照常收到应答，handler 发出 `listener_error`，载荷 `{ block, error }`；
- 单元内没有数据块的地址读为 0 / false，写入被忽略，不应答异常，因此跨越空档的整块读取仍能成功；handler 对每个（类型、单元、地址）只发出一次 `unmapped`，最多 1024 个地址，之后发出一次 `unmapped_limit`，不再发出 `unmapped`（见“事件”）；
- 未登记的单元号由 es-modbus 应答异常码 0x0B；非法功能码、数量或地址越界应答 0x01 / 0x03 / 0x02。

## 4. 接口

- `Modbus_Emulator(source)`：主构造方法，`source` 是描述文件的路径（§5），或路径列表：多个文件作为同一份描述一并读取；建立数据块和服务；
  - `blocks`：数据块名到 Ldata 的映射；`block(name)` 取得一个数据块；`unit_map`：单元表；`servers`：服务实例；`layouts`：已注册的布局（按名称，只读）；`handler`：全部服务共用的 handler；`warnings`：构造时发现的诊断信息（字符串），构造函数返回前无法挂监听器，所以收在这里；没有时为空；
  - `start(options)`：启动全部服务。缺省为全部或全部不：任一服务启动失败时停掉全部服务，因此 `start()` 成功即全部在运行，失败即全部已停止；`{ partial: true }` 时尽力启动，已启动的服务保持运行。两种模式下有失败都以 `AggregateError` 拒绝，列出全部失败的服务：每项是一个 `Error`，消息标明服务，如 `servers[1] (modbus://0.0.0.0:503): ...`，原始错误放在 `cause`；
  - `stop()`：停止全部服务；
  - 描述文件不合法时抛出 `Error`，其 `errors` 属性列出全部违规项；文件无法读取也是其中一项。
- `create_tcp_server(host, port, unit_map, { rtu, unit_ids, handler })`：创建 Modbus TCP 服务，`host` 缺省 `0.0.0.0`、`port` 缺省 502，`unit_map` 必填；`rtu: true` 时在 TCP 套接字上使用 RTU 帧（RTU over TCP）。返回 es-modbus 的 `Modbus_Server`，未启动。
- `create_rtu_server(path, unit_map, { baud_rate, parity, data_bits, stop_bits, unit_ids, handler })`：创建串口上的 RTU 从站，`unit_map` 必填，`baud_rate`、`parity`、`data_bits`、`stop_bits` 缺省为 9600、`none`、8、1。返回 `Modbus_Server`，`start()` 时才打开串口。
- `Unit_Map` / `create_handler(unit_map)`：单元表和 es-modbus 的服务端 handler，供不用描述文件的调用方（如控制器）自行组装。
  - `attach_unit(unit_id, block, start, offset)` 把数据块从其字节 `offset` 起放到单元的字节 `start` 处；两者缺省为 0，须为偶数非负整数，否则抛出 `RangeError`；同一单元内各数据块的字节区间不得重叠，重叠时抛出 `Error`，指明两个数据块；
  - `unit_ids`：有数据块的单元，按首次挂载的顺序；`segments(unit_id)`：单元的字节区间（`{ block, start, offset, end }`），按 `start` 排序，没有数据块的单元为空；`resolve(unit_id, byte)`：单元中某个字节所在的数据块及块内字节偏移（`{ block, offset }`），未映射时为 null。
- `Ldata`、`Ltag`、`register_layout`、`get_layout`、`io_index_table`、`render_types`，以及与之相配的 layout-data 类型（`Layout`、`Layout_Tag`、`Layout_Item`、`Tag_Item`、`Include_Item`、`Layout_Description`、`Layout_Source`、`Registered_Layouts`、`Endian`、`Tag_Type`）：调用方用到的 [layout-data](https://github.com/goosy/layout-data/blob/main/doc/spec-data-api.md) 接口，原样转发。数据块就是 `Ldata` 对象，所以调用方只从本包取得这些接口，不再自己依赖 layout-data，进程里也只有一份（`register_layout` 每个进程只能成功调用一次，需要这一点）。转发的接口随本包所依赖的 layout-data 版本而变。
- `unit_ids`：可选，该服务应答的单元号列表，省略时，工厂在创建服务时复制 `unit_map` 中的单元号；此后这个列表属于服务，与单元表相互独立：`attach_unit` 只改变单元表，与服务应答哪些单元没有任何关系。要给服务增加（或去掉）单元，调用其 `Modbus_Server` 的 `set_unit_ids`；列表外的单元号由 es-modbus 应答异常码 0x0B；
- `handler`：可选，要服务的 handler（`create_handler` 的结果）；同一个单元表的多个服务可以共用一个，缺省时由单元表建立；

### 事件

本包以事件报告诊断信息，自身不输出任何内容。

- `create_handler` 返回的 handler 是 `EventEmitter`：

  | 事件 | 载荷 | 时机 |
  | --- | --- | --- |
  | `unmapped` | `{ kind, unit_id, addr }`，`kind` 为 `"holding_register"`、`"input_register"` 或 `"coil"` | 读写未映射的地址；每个（类型、单元、地址）只发一次，最多 1024 个地址 |
  | `unmapped_limit` | `{ limit }` | 已发出第 1024 个地址，之后的未映射地址不再发出 |
  | `listener_error` | `{ block, error }` | 提交一次请求时块的监听器（`change`、`write`、`access`）抛出异常；数据保持写入，主站照常收到应答 |

- 服务是 es-modbus 的 `Modbus_Server`，事件为 es-modbus 原有的：`start`、`stop`、`socket_connect`（socket）、`socket_disconnect`（socket）、`socket_error`（error）、`error`（error）、`handler_error`（error）。工厂不添加监听器。`EventEmitter` 在 `error` 事件无监听器时会抛出异常，所以直接使用工厂的调用方须自行监听每个服务的 `error`。
- handler 抛出异常或返回无效值（批量读的长度不符、寄存器值越界）时，由 es-modbus 作为 `handler_error` 报告，主站收到异常码 0x04。
- `Modbus_Emulator` 是 `EventEmitter`：把每个服务的事件 `<name>` 转发为 `server_<name>`（`server_start`、`server_stop`、`server_socket_connect`、`server_socket_disconnect`、`server_socket_error`、`server_error`、`server_handler_error`），载荷为 `{ server, label }`，es-modbus 带有参数时再加 `socket` 或 `error`；`label` 是服务的标签，与 `start()` 报错中的相同，如 `servers[1] (modbus://0.0.0.0:503)`。handler 的事件按原名、原载荷转发。模拟器始终监听其服务的 `error`，自身从不发出 `error`。

## 5. 描述文件

一个 YAML 1.2 文件，含三部分。这三部分也可以分写在多个文件里（`source` 列表）：各文件的 `blocks` 和 `servers` 按文件顺序连接，全部文件的布局一并注册，出错信息会指明所在文件。

文件的根键有 `blocks`、`servers`、`layouts_file`，以及 layout-data 的布局与片段（`layouts` 和片段名）。`blocks` 和 `servers` 属于本包，不会传给 layout-data；其余部分是布局的来源。

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

- `blocks[].name` 缺省为 `unit_<unit_id>`，数据块名不得重复；同一单元内各数据块的字节区间不得重叠；`offset`（可选）为数据块内的起始字节，须为偶数；
- `servers[].protocol` 取 `tcp`、`rtu_over_tcp`、`rtu`；`tcp` 和 `rtu_over_tcp` 的 `host` 缺省 `0.0.0.0`、`port` 缺省 502，`port` 为 0..65535 的整数（0 表示由系统分配）；`rtu` 的 `port` 为串口路径，可带 `baud_rate`、`parity`、`data_bits`、`stop_bits`；
- 两个 `tcp` / `rtu_over_tcp` 服务不得使用相同的 `host` 和 `port`（端口 0 除外），不同 `host` 可用同一端口；两个 `rtu` 服务不得使用同一串口路径；
- 数据块条目只有 `name`、`unit_id`、`layout`、`start`、`offset` 这些键；服务条目只有 `protocol`、`unit_ids`，以及 `tcp` / `rtu_over_tcp` 的 `host`、`port` 或 `rtu` 的 `port`、`baud_rate`、`parity`、`data_bits`、`stop_bits`；其他键是错误。根键不检查：`blocks`、`servers`、`layouts_file` 以外的键是 layout-data 的片段名；
- `servers[].unit_ids`（可选）：该服务应答的单元号，非空整数列表，取值 0..255，且每个单元号必须有数据块；缺省应答全部单元；
- 布局可以不写在描述里，而用根键 `layouts_file` 指向一个布局文件（相对于写下它的文件），也可同时给出 `layouts` 和片段，它们一并注册（同名重复定义是错误）；两者都没有时，数据块使用进程里已经注册的布局；
- 所有服务共用同一个单元表和同一组数据块，`unit_ids` 只决定各服务应答哪些单元。

## 6. 发布形态

- 以 ES 模块库发布，入口 `modbus_emulator`；依赖 `layout-data`、`es-modbus` 和 `yaml`，都保持外部引用：本包是给其他包依赖的，使用它的应用把它们统一打包一次；
- Node.js >= 20.11。
