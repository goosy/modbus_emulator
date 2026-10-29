# modbus-emulator 规范

## 1. 目标与范围

modbus-emulator 是一个 Modbus 设备模拟器库：对外提供 Modbus 从站服务，并通过 [layout-data](https://github.com/goosy/layout-data/blob/main/doc/spec-data-api.md) 的 Ldata / Ltag 对外提供操作 API，使调用方可以施加额外的运算，模拟一个数据块的运行。

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

- 布局和数据块装入后是静态的：模拟器的每次 `load` 增加数据块、服务和布局，已有的不再删除或改变；运行中的服务只关心数值，不处理数据块的变更；

- 寄存器 `addr` 对应单元内的字节 `addr * 2`，按大端读写数据块的内容；
- 线圈 `addr` 对应字节 `addr >> 3` 的第 `addr % 8` 位；
- 保持寄存器与输入寄存器内容相同；寄存器和线圈可读写；
- 写入经 Ldata 的写入方法完成，因此数据块的 `change` 和 `write` 事件照常触发；
- 一次 FC 16 / FC 15 请求是原子的：对写到的每个块写入一次，发出一次 `write` 和一次 `write` 类的 `access`；写入中途失败时，涉及的块全部恢复，主站收到异常码 0x04。FC 6 / FC 5 写一个点。这由 handler 完成，所以用 `create_handler` 自行装配的服务行为相同；
- 一次读请求对读到的每个块发出一次 `read` 类的 `access`，只报告被读的 tag；线圈只报告被读的位所对应的 Bool；
- 提交一次请求时，块的监听器（`change`、`write`、`access`）抛出的异常既不撤销写入，也不影响其他块：主站照常收到应答，handler 发出 `listener_error`，载荷 `{ block, error }`；
- 单元内没有数据块的地址读为 0 / false，写入被忽略，不应答异常，因此跨越空档的整块读取仍能成功；handler 对每个（类型、单元、地址）只发出一次 `unmapped`，最多 1024 个地址，之后发出一次 `unmapped_limit`，不再发出 `unmapped`（见“事件”）；
- 服务不应答的单元号，在 `tcp` 下由 es-modbus 应答异常码 0x0B，在串行总线（`rtu`、`rtu_over_tcp`）上不作应答；非法功能码、数量或地址越界应答 0x01 / 0x03 / 0x02；
- 在串行总线（`rtu`、`rtu_over_tcp`）上，unit 0 是广播地址：es-modbus 执行对它的写入，但从不应答，所以经这类服务读不到 unit 0 的数据块；248..255 在串行总线上是保留地址。这类协议的服务应答 unit 0 或 248..255 中的单元时，模拟器发出 `warning` 事件（见“事件”），不作为错误。

## 4. 接口

- `Modbus_Emulator(scope)`：主构造方法，建立一个没有数据块和服务的模拟器，使调用方能在装入任何内容之前挂上监听器；`scope`（可选）是描述装入的 layout-data 登记域的名称，缺省为 `modbus_emulator`；名称不是标识符时抛出 `create_scope` 的错误；
  - `load(sources)`：装入描述，可以调用任意多次。`sources` 是一个来源或来源列表，一并读取；每个来源是描述文件（路径或 `file:` URL，§5），由本包用 `desc_file` 编译，或是 layout-data 的 `Description`，由调用方用本包转发的 `desc_file` 或 `yaml` 编译；列表中两者可以混用，其他值不是来源。描述文件服务于最终使用者，他们写的是配置文件；`Description` 服务于动态生成描述的程序。描述给出布局、要建立的数据块和服务的参数，`load` 据此建立数据块和服务，不启动服务。返回 `{ blocks, servers }`：本次新增的数据块（数据块名到 Ldata 的映射）和服务。每次装入都对照模拟器的全部状态检查：与模拟器已有数据块同名、与先前装入的数据块重叠、与先前的服务端口相同都是错误，`unit_ids` 中的单元是装入后模拟器的单元。未写 `unit_ids` 的服务应答模拟器的全部单元，包括之后装入的单元；
  - 与描述结构相同的对象用 `yaml(JSON.stringify(object))` 编译，因为 JSON 是 YAML 1.2 的子集。YAML 文本没有所在文件，其 `imports` 要写绝对路径或 `file:` URL；
  - `blocks`：数据块名到 Ldata 的映射；`block(name)` 取得一个数据块；`unit_map`：单元表；`servers`：服务实例，一个数组，第 `i` 项对应已装入描述（各次装入按顺序、一次装入的各来源按顺序连接后）中的第 `i` 个服务条目；每个服务的 `name` 是它的标签，即它在描述中的位置和地址，如 `servers[1] (modbus://0.0.0.0:503)`，因此可以按名称查找（`servers.find((server) => server.name === ...)`）；`scope`：描述装入的 layout-data 登记域（只读）；`layouts`：描述在该登记域中的布局（按名称，只读），键的顺序没有意义；`handler`：全部服务共用的 handler；
  - `start(options)`：启动尚未运行的服务：首次调用或 `stop()` 之后启动全部服务，否则启动上次调用以来装入的服务；运行中的服务不重启。模拟器没有服务时以 `Error` 拒绝。缺省为全部或全部不：任一服务启动失败时停掉全部服务，因此 `start()` 成功即全部在运行，失败即全部已停止；`{ partial: true }` 时尽力启动，已启动的服务保持运行。两种模式下有失败都以 `AggregateError` 拒绝，列出全部失败的服务：每项是一个 `Error`，消息以服务的 `name` 开头，如 `servers[1] (modbus://0.0.0.0:503): ...`，原始错误放在 `cause`；
  - `stop()`：停止全部服务，并把数据块名交还给其布局（见下面的布局登记域）；数据块照常可用，`start()` 会再次服务它们；
  - 布局登记域：描述不指定登记域，登记域只在代码中选择。`load` 把描述装入名为 `scope` 的登记域，不存在时创建（layout-data 的 `get_scope` / `create_scope`），它使这些布局与调用方、其他使用 layout-data 的库的登记域互不相干。装入就是 layout-data 的 `load`：在一个登记域中，与已有布局同名且结构相同的布局共用，同名而结构不同、或结构相同而名称不同是错误；这样的布局要给模拟器指定不同的登记域。每个数据块是由其布局建立的 Ldata，布局持有数据块名：同一布局的同一数据块名是错误，直到持有它的模拟器停止（`stop()`）。因此先前的模拟器 `stop()` 后，另一个模拟器可以在同一登记域中装入同一份描述，同时装入多个则用不同的登记域。模拟器在 `stop()` 后仍保有其数据块，所以向它装入同名数据块仍是错误；
  - 来源不合法时抛出 `Error`，其 `errors` 属性列出全部违规项：本包的、登记域 `load` 的，以及描述文件的 `desc_file` 错误（它们指明文件，文件无法读取也是其中一项）；既不是描述文件也不是 `Description` 的值也是其中一项。`Description` 的编译错误在调用方编译时由 `desc_file` 或 `yaml` 抛出。装入失败时什么也不改变：模拟器的数据块、单元表、服务、布局以及登记域都保持调用前的状态。
- `create_tcp_server(unit_map, { host, port, rtu, unit_ids, handler, name })`：创建 Modbus TCP 服务，`host` 缺省 `0.0.0.0`、`port` 缺省 502，`unit_map` 必填；`rtu: true` 时在 TCP 套接字上使用 RTU 帧（RTU over TCP）。返回 es-modbus 的 `Modbus_Server`，未启动。
- `create_rtu_server(path, unit_map, { baud_rate, parity, data_bits, stop_bits, unit_ids, handler, name })`：创建串口上的 RTU 从站，`unit_map` 必填，`baud_rate`、`parity`、`data_bits`、`stop_bits` 缺省为 9600、`none`、8、1。返回 `Modbus_Server`，`start()` 时才打开串口。
- `name`：可选，`Modbus_Server` 的 `name`，在事件和错误中标明服务；es-modbus 的缺省值为 `Modbus_Server`；
- `Unit_Map` / `create_handler(unit_map)`：单元表和 es-modbus 的服务端 handler，供不用描述的调用方（如控制器）自行组装。
  - `attach_unit(unit_id, block, start, offset)` 把数据块从其字节 `offset` 起放到单元的字节 `start` 处；两者缺省为 0，须为偶数非负整数，否则抛出 `RangeError`；同一单元内各数据块的字节区间不得重叠，重叠时抛出 `Error`，指明两个数据块；
  - `unit_ids`：有数据块的单元，按首次挂载的顺序；`segments(unit_id)`：单元的字节区间（`{ block, start, offset, end }`），按 `start` 排序，没有数据块的单元为空；`resolve(unit_id, byte)`：单元中某个字节所在的数据块及块内字节偏移（`{ block, offset }`），未映射时为 null。
- `Ldata`、`Ltag`、`create_scope`、`get_scope`、`yaml`、`desc_file`，以及与之相配的 layout-data 类型（`Layout`、`Layout_Scope`、`Layout_Tag`、`Layout_Desc`、`Block_Desc`、`Description`、`Registration`、`Endian`、`Tag_Type`）：调用方用到的 [layout-data](https://github.com/goosy/layout-data/blob/main/doc/spec-data-api.md) 接口，原样转发。`load`、查找布局、`create_ldata`、`get_ldata`、`delete_ldata`、`io_index_table` 是登记域或布局的方法。登记域的 `load` 只接受编译好的描述：`yaml` 和 `desc_file` 分别编译 YAML 文本和描述文件。数据块就是 `Ldata` 对象，所以调用方只从本包取得这些接口，不再自己依赖 layout-data，进程里也只有一份（登记域需要这一点：两份 layout-data 互不共享登记域，一份的 `get_scope` 找不到另一份的登记域）。转发的接口随本包所依赖的 layout-data 版本而变。
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

- 服务是 es-modbus 的 `Modbus_Server`，事件为 es-modbus 原有的：`start`、`stop`、`socket_connect`（socket）、`socket_disconnect`（socket）、`socket_error`（error）、`error`（error）、`handler_error`（error）、`receive`（请求帧）、`send`（应答帧）。工厂不添加监听器。`EventEmitter` 在 `error` 事件无监听器时会抛出异常，所以直接使用工厂的调用方须自行监听每个服务的 `error`。
- handler 抛出异常或返回无效值（批量读的长度不符、寄存器值越界）时，由 es-modbus 作为 `handler_error` 报告，主站收到异常码 0x04。
- `Modbus_Emulator` 是 `EventEmitter`：把每个服务的事件 `<name>` 转发为 `server_<name>`（`server_start`、`server_stop`、`server_socket_connect`、`server_socket_disconnect`、`server_socket_error`、`server_error`、`server_handler_error`、`server_receive`、`server_send`），载荷为 `{ server }`，es-modbus 带有参数时再加 `socket`、`error` 或 `frame`；由 `server.name` 得知来自哪个服务。handler 的事件按原名、原载荷转发。模拟器始终监听其服务的 `error`，自身从不发出 `error`。
- `Modbus_Emulator` 对 `load` 的每条诊断发出 `warning`，载荷为 `{ server, message }`：串行总线上的服务应答 unit 0 或 248..255 中的单元（§3），每个服务每类一次；`message` 以服务的 `name` 开头。未写 `unit_ids` 的服务在之后的装入增加单元时再次检查这些单元。

## 5. 描述

layout-data 的描述（见 [spec-description](https://github.com/goosy/layout-data/blob/main/doc/spec-description.md)），写在 YAML 1.2 文件或文本中，由 `desc_file` 或 `yaml` 编译，外加本包的根键 `servers`。它含三部分。这三部分也可以分写在多个来源里（一次 `load` 的 `sources` 列表）：各来源的 `blocks` 和 `servers` 按列表顺序连接，全部描述一并装入登记域；有多个来源时，本包的出错信息以来源开头：描述文件用其路径，`Description` 用 `description #N`，与 layout-data 对列表项的称呼相同。`blocks` 和 `servers` 可以各自省略，但一次装入至少给出其中之一。条目接着先前装入的条目编号，所以 `blocks[i]`、`servers[i]` 就是条目在模拟器中的位置。

layout-data 读取 `imports`（引入其条目表的描述文件）、`layouts`（布局名列表）、`item_tables`（按名称给出的条目表）和 `blocks`，数据块条目中它读取 `name` 和 `layout`，条目的其他键属于本包。描述是自包含的：数据块引用本描述 `layouts` 列出的布局，其条目表可以来自 `imports` 中的文件。描述不指定登记域（§4）。

```yaml
# 1. layouts and item tables, in the format of layout-data
layouts: [PUMP]
item_tables:
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

- `blocks[].name` 必须写明，是其布局的其他数据块、模拟器的其他数据块都未用过的字符串（layout-data 与本包）；`blocks[].layout` 是同一描述中的布局名；同一单元内各数据块的字节区间不得重叠；`offset`（可选）为数据块内的起始字节，须为偶数；
- `servers[].protocol` 取 `tcp`、`rtu_over_tcp`、`rtu`；`tcp` 和 `rtu_over_tcp` 的 `host` 缺省 `0.0.0.0`、`port` 缺省 502，`port` 为 0..65535 的整数（0 表示由系统分配）；`rtu` 的 `port` 为串口路径，可带 `baud_rate`（正整数，缺省 9600）、`parity`（`none`、`odd` 或 `even`，缺省 `none`）、`data_bits`（5、6、7 或 8，缺省 8）、`stop_bits`（1、1.5 或 2，缺省 1）；
- 两个 `tcp` / `rtu_over_tcp` 服务不得使用相同的 `host` 和 `port`（端口 0 除外），不同 `host` 可用同一端口；两个 `rtu` 服务不得使用同一串口路径；
- 数据块条目只有 `name`、`unit_id`、`layout`、`start`、`offset` 这些键；服务条目只有 `protocol`、`unit_ids`，以及 `tcp` / `rtu_over_tcp` 的 `host`、`port` 或 `rtu` 的 `port`、`baud_rate`、`parity`、`data_bits`、`stop_bits`；其他键是错误。根键不检查：`imports`、`layouts`、`item_tables`、`blocks`、`servers` 以外的键不被使用，可以存放任何内容（如 YAML 锚点）；
- `servers[].unit_ids`（可选）：该服务应答的单元号，非空整数列表，取值 0..255，且每个单元号在装入后必须有数据块；缺省应答全部单元，包括之后装入的单元；
- 条目表可以不写在描述里：描述用 `imports` 引入它们，并在 `layouts` 中列出自己的布局；布局文件也与其他来源一样是 `sources` 列表的一项：全部来源一并装入，列出同名且结构相同布局的描述共用该布局；
- 所有服务共用同一个单元表和同一组数据块，`unit_ids` 只决定各服务应答哪些单元。

## 6. 发布形态

- 以 ES 模块库发布，入口 `modbus-emulator`；发布的是源码的打包文件（`dist/index.js`）及其类型声明；
- 依赖 `layout-data` 和 `es-modbus`，都不打包，在打包文件里保持为 `import`：本包是给其他包依赖的，使用它的应用把它们统一打包一次；
- Node.js >= 20.11。
