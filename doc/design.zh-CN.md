# modbus_emulator 设计

> 需求见 [spec.zh-CN.md](spec.zh-CN.md)。本文说明实现。

## 1. 源文件

| 文件 | 职责 |
| --- | --- |
| `src/index.js` | 包的公开接口，含转发的 layout-data 接口 |
| `src/unit_map.js` | `Unit_Map` 与 es-modbus 的服务端 vector |
| `src/server.js` | `create_tcp_server`、`create_rtu_server`，以及服务事件的日志 |
| `src/emulator.js` | `Modbus_Emulator`：读取描述文件、建立设备和服务 |
| `src/index.d.ts` | 公开接口的类型声明（手写） |

依赖：`layout-data`（布局注册与 Ldata）是运行时依赖，保持外部引用：设备的 Ldata 对象会交到调用方手里，如果在这里打包一份，就会和调用方自己的那份并存。`src/index.js` 转发调用方用到的那部分接口（`export ... from "layout-data"`，类型在 `src/index.d.ts`），调用方从本包导入，进程里就只有一份。`es-modbus` 和 `yaml` 同样是运行时依赖，保持外部引用：本包是给其他包依赖的，不是应用，所以不打包它们。使用本包的应用把它们统一打包一次，未用到的 `Modbus_Client` 随之去掉，共用的代码只有一份，串口原生模块的 `prebuilds` 目录也只有一处（它们在持有它们的包旁边查找；作为包安装时就是 es-modbus 自己的 `prebuilds` 目录）。`Modbus_Server` 在 `src/index.d.ts` 里声明为调用方用到的小接口，因为 es-modbus 没有类型声明。`rolldown.config.js` 的 `external` 列表取自 `dependencies`，所以只把本包自己的源文件合并起来。`layout-data` 锁定为已发布的版本号；本地联调时可临时用 pnpm 的 `link:` 指向本地目录，但提交和发布前必须改回版本号。

## 2. Unit_Map 与 vector

- `Unit_Map.attach_unit(unit_id, block, start, offset)` 把 Ldata 挂到某个单元的字节区间 `[start, start + size)`，一个单元可以挂多个 Ldata；`unit_ids` 列出已挂的单元号。
- `create_vector(unit_map, { logger })` 返回 es-modbus 要求的 vector，方法名为 snake_case：`get_holding_register`、`get_input_register`、`set_register`、`get_coil`（同时用于 FC 1 和 FC 2）、`set_coil`。
- 寄存器 `addr` 对应字节 `addr * 2`，按大端用 Ldata 的 `read_bytes` 读取；线圈 `addr` 对应字节 `addr >> 3` 的第 `addr % 8` 位。
- 写入经 Ldata 的 `write_bytes` / `write_bit`，由 Ldata 在每次写入后检测变化；Ldata 的字节不能以其他方式访问。
- es-modbus 对每个寄存器或线圈各调用一次 vector，所以写一个寄存器是一次两字节的 `write_bytes`（字节取自共用的两字节数组，`write_bytes` 立即复制），读一个寄存器是一次两字节的 `read_bytes`。
- 未映射的地址读为 0 / false，写入被忽略；每个（类型、单元、地址）只经 `logger.warn` 报告一次，避免轮询时刷屏。
- 请求由 es-modbus 先行校验：vector 抛出异常时应答 0x04，并通过 `vector_error` 事件记录日志。
- FC 16 请求在同一个同步调用中连续写多个寄存器；需要合并通知的调用方可以用 `setImmediate` 合并（有测试保证这一点）。

## 3. 服务

- `create_tcp_server(host, port, unit_map, { rtu, unit_ids, logger })`：用 vector 创建 `Modbus_Server`，`unit_id` 取选项 `unit_ids`，缺省取 `unit_map.unit_ids`（es-modbus 在构造时把它复制为集合，之后新增的单元不会生效，所以单元要在创建服务前挂好）；`rtu` 传给 es-modbus 的同名选项；`vector` 选项缺省时用 `create_vector` 建立。
- `Modbus_Emulator` 在建好单元表后只建立一个 vector（`emulator.vector`），传给它的全部服务：vector 只按单元表查找、没有其他状态，共用后“未映射地址”的警告在全部服务中合计只报告一次，而不是每个服务各报告一次。vector 依赖单元表和日志器，所以不能放在模块顶层，否则同一进程内的多个模拟器会互相串用。
- `create_rtu_server(path, unit_map, { baud_rate, parity, data_bits, stop_bits, unit_ids, logger })`：`unit_ids` 同上；`port` 取串口路径，es-modbus 据此选 RTU 传输；构造时检查参数，`start()` 才打开串口，所以构造不需要硬件。
- `normalize_logger(logger)` 把调用方的日志器规整为含 `info` / `warn` / `error` 的对象，缺少的方法静默；两种服务都把 `start`、`stop` 以及客户端的连接和断开记为 `info`（它们是正常事件），把 `error`、`vector_error` 和套接字错误记为 `error`。

## 4. Modbus_Emulator

- 构造：`source` 是路径或路径列表，每个文件用 `yaml` 解析；列表项也可以是对象，这是给控制器按自己的配置拼出描述用的内部入口，不属于公开接口（规范和类型声明只写文件路径），其中相对的 `layouts_file` 相对于当前目录；从每个文件取出根键 `devices`、`servers`、`layouts_file`：`devices` 和 `servers` 按文件顺序连接（有多个文件时，出错信息带文件名前缀），`layouts_file` 相对于它自己所在的文件，文件的其余部分（`layouts` 与片段，如有）原样作为一个来源；这些来源和布局文件作为同一次 `layout-data` `register_layout` 调用的来源，一并注册（`devices` 和 `servers` 不会传给它，否则会被当成片段）；没有来源时模拟器不注册，设备使用进程里已注册的布局。
- 校验收集全部违规项后一次抛出：布局错误、设备（`unit_id` 范围、布局是否存在、`start` 为偶数、名称重复）、服务（协议、端口、`unit_ids` 的格式，以及其中的单元号是否有设备，后者在设备读完后检查）。
- 每个设备创建一个 Ldata 并挂到单元表；布局由模拟器注册（`register_layout` 每个进程只能成功调用一次，所以每个进程一个模拟器），设备按布局名创建（`new Ldata(布局名, 设备名)`）；每个服务创建一个 `Modbus_Server`，共用同一单元表。
- `start()` / `stop()` 并行启动 / 停止全部服务。

## 5. 构建与测试

- `pnpm build`：rolldown 把 `src/index.js` 打包为 `dist/modbus_emulator.js`；
- `pnpm test`：先构建，再 `node --test`；测试用 es-modbus 的 `Modbus_Client` 作主站，RTU 串口只测构造；
- `pnpm lint`：ESLint。
