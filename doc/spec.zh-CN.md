# modbus_emulator 规范

## 1. 目标与范围

modbus_emulator 是一个 Modbus 设备模拟器库：对外提供 Modbus 从站服务，并通过 [layout-data](https://www.npmjs.com/package/layout-data) 的 Ldata / Ltag 对外提供操作 API，使调用方可以施加额外的运算，模拟一个设备的运行。

- 从站服务的传输：Modbus TCP、RTU over TCP、RTU（串口）；
- 同一个模拟器可以同时提供多个服务，共用同一组数据块；
- 以库的形式发布；控制器等程序可以用它的服务端部分，向上位机（HMI/SCADA）发布自己的数据块。

不在范围内：Modbus 主站（客户端）、设备的业务逻辑（由调用方通过 Ldata 实现）、日志的具体实现（由调用方注入）。

## 2. 术语

| 术语 | 含义 |
| --- | --- |
| 设备 | 一个具名的数据块（Ldata），按布局存放，挂在某个单元号的某个字节偏移处 |
| 单元（unit） | 以单元号（unit id）区分的一个从站地址；一个单元可以挂多个设备，各占不同的字节区间 |
| 单元表（Unit_Map） | 单元号到设备及其字节区间的映射 |

## 3. 地址映射

- 布局和数据块是静态的：描述文件在构造时一次读入，设备（Ldata）和单元表建好后不再增删或改变布局；运行中的服务只关心数值，不处理数据块的变更；

- 寄存器 `addr` 对应单元内的字节 `addr * 2`，按大端读写设备的内容；
- 线圈 `addr` 对应字节 `addr >> 3` 的第 `addr % 8` 位；
- 保持寄存器与输入寄存器内容相同；寄存器和线圈可读写；
- 写入经 Ldata 的写入方法完成，因此设备的 `change` 和 `write` 事件照常触发；
- 单元内没有设备的地址读为 0 / false，写入被忽略，不应答异常，因此跨越空档的整块读取仍能成功；每个（类型、单元、地址）只报告一次警告；
- 未登记的单元号由 es-modbus 应答异常码 0x0B；非法功能码、数量或地址越界应答 0x01 / 0x03 / 0x02。

## 4. 接口

- `Modbus_Emulator(source, options)`：主构造方法，`source` 是描述文件的路径（§5），建立设备和服务；
  - `devices`：设备名到 Ldata 的映射；`device(name)` 取得一个设备；`unit_map`：单元表；`servers`：服务实例；
  - `start()` / `stop()`：启动 / 停止全部服务；
  - 描述文件不合法时抛出 `Error`，其 `errors` 属性列出全部违规项。
- `create_tcp_server(host, port, unit_map, { rtu, unit_ids, logger })`：创建 Modbus TCP 服务；`rtu: true` 时在 TCP 套接字上使用 RTU 帧（RTU over TCP）。返回 es-modbus 的 `Modbus_Server`，未启动。
- `create_rtu_server(path, unit_map, { baud_rate, parity, data_bits, stop_bits, unit_ids, logger })`：创建串口上的 RTU 从站。返回 `Modbus_Server`，`start()` 时才打开串口。
- `Unit_Map` / `create_vector(unit_map, { logger })`：单元表和 es-modbus 的服务端 vector，供不用描述文件的调用方（如控制器）自行组装。
- `unit_ids`：可选，该服务应答的单元号列表，缺省为 `unit_map` 中的全部单元；列表外的单元号由 es-modbus 应答异常码 0x0B；
- `vector`：可选，要服务的 vector（`create_vector` 的结果）；同一个单元表的多个服务可以共用一个，缺省时由单元表建立；
- `logger`：可选，含 `info` / `warn` / `error` 方法；缺省或缺方法时不输出。

## 5. 描述文件

一个 YAML 1.2 文件，含三部分：

```yaml
# 1. layouts and fragments, in the format of layout-data
layouts:
  PUMP:
    - { name: id, type: UInt, offset: 0, init_value: 7 }
    - { name: pressure, type: Real, offset: 16, init_value: 1.5 }

# 2. the devices
devices:
  - { name: pump_1, unit_id: 1, layout: PUMP }               # unit_id: 0..255
  - { name: pump_2, unit_id: 1, layout: PUMP, start: 400 }   # start: byte offset in the unit, even

# 3. the services
servers:
  - { protocol: tcp, host: 0.0.0.0, port: 502 }
  - { protocol: rtu_over_tcp, port: 503 }
  - { protocol: rtu, port: COM3, baud_rate: 9600, parity: none }
```

- `devices[].name` 缺省为 `unit_<unit_id>`，设备名不得重复；`offset`（可选）为设备数据块内的起始字节；
- `servers[].protocol` 取 `tcp`、`rtu_over_tcp`、`rtu`；`tcp` 和 `rtu_over_tcp` 的 `host` 缺省 `0.0.0.0`、`port` 缺省 502；`rtu` 的 `port` 为串口路径，可带 `baud_rate`、`parity`、`data_bits`、`stop_bits`；
- `servers[].unit_ids`（可选）：该服务应答的单元号，非空整数列表，取值 0..255，且每个单元号必须有设备；缺省应答全部单元；
- 布局可以不写在描述里，而用根键 `layouts_file` 指向一个布局文件（相对于描述文件），也可同时给出 `layouts` 和片段，它们一并注册（同名重复定义是错误）；两者都没有时，设备使用进程里已经注册的布局；
- 所有服务共用同一个单元表和同一组设备数据块，`unit_ids` 只决定各服务应答哪些单元。

## 6. 发布形态

- 以 ES 模块库发布，入口 `modbus_emulator`；依赖 `layout-data` 和 `es-modbus`；`yaml` 打包进库；
- Node.js >= 20.11。
