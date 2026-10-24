# modbus_emulator 设计

> 需求见 [spec.zh-CN.md](spec.zh-CN.md)。本文说明实现。

## 1. 源文件

| 文件 | 职责 |
| --- | --- |
| `src/index.js` | 包的公开接口，含转发的 layout-data 接口 |
| `src/unit_map.js` | `Unit_Map` 与 es-modbus 的服务端 handler |
| `src/server.js` | `create_tcp_server`、`create_rtu_server` |
| `src/emulator.js` | `Modbus_Emulator`：读取描述文件、建立数据块和服务 |
| `src/index.d.ts` | 公开接口的类型声明（手写） |

依赖：

- `layout-data`（布局注册与 Ldata）：运行时依赖，保持外部引用。数据块的 Ldata 对象会交到调用方手里，如果在这里打包一份，就会和调用方自己的那份并存。
  - `src/index.js` 转发调用方用到的那部分接口（`export ... from "layout-data"`，类型在 `src/index.d.ts`），调用方从本包导入，进程里就只有一份。
- `es-modbus`、`yaml`：运行时依赖，保持外部引用。本包是给其他包依赖的，不是应用，所以不打包它们。
  - 使用本包的应用把它们统一打包一次：未用到的 `Modbus_Client` 随之去掉，共用的代码只有一份，串口原生模块的 `prebuilds` 目录也只有一处（它们在持有它们的包旁边查找；作为包安装时就是 es-modbus 自己的 `prebuilds` 目录）。
  - `Modbus_Server` 在 `src/index.d.ts` 里声明为调用方用到的小接口，因为 es-modbus 没有类型声明。
- 打包：`rolldown.config.js` 的 `external` 列表取自 `dependencies`，所以只把本包自己的源文件合并起来。
- 版本与联调：
  - `layout-data` 锁定为已发布的版本号。
  - 联调尚未发布的依赖（layout-data、es-modbus）时，只用 yalc 临时引用（`file:.yalc/<name>`），它按普通依赖安装发布内容；提交和发布前必须改回版本号。
  - 不要用 pnpm 的 `link:`：它从依赖自己的仓库目录解析模块，会使调用方对同一个模块出现两个实例。

## 2. Unit_Map 与 handler

- `Unit_Map.attach_unit(unit_id, block, start, offset)` 把 Ldata 挂到某个单元的字节区间 `[start, start + size)`，一个单元可以挂多个 Ldata；`unit_ids` 列出已挂的单元号。
- `create_handler(unit_map)` 返回 es-modbus 要求的 handler，方法名为 snake_case：`get_holding_register`、`get_input_register`、`set_holding_register`、`get_coil`（同时用于 FC 1 和 FC 2）、`set_coil`。handler 是 `EventEmitter`（`Object.assign(new EventEmitter(), methods)`）。
- 寄存器 `addr` 对应字节 `addr * 2`，按大端用 Ldata 的 `read_bytes` 读取；线圈 `addr` 对应字节 `addr >> 3` 的第 `addr % 8` 位。
- 写入经 Ldata 的 `write_bytes` / `write_bit`，由 Ldata 在每次写入后检测变化；Ldata 的字节不能以其他方式访问。
- es-modbus 对每个寄存器或线圈各调用一次 handler，所以写一个寄存器是一次两字节的 `write_bytes`（字节取自共用的两字节数组，`write_bytes` 立即复制），读一个寄存器是一次两字节的 `read_bytes`。
- 未映射的地址读为 0 / false，写入被忽略；每个（类型、单元、地址）只发出一次 `unmapped`，避免轮询时淹没监听器。已报告的地址记在一个最多 1024 项的集合中（`MAX_UNMAPPED_REPORTS`），否则主站扫描整个地址空间时它会增长到 65536 × 3 × 256 项；集合满后发出一次 `unmapped_limit`，之后的地址既不发出也不记录。
- 请求由 es-modbus 先行校验：handler 抛出异常时应答 0x04，es-modbus 在服务上发出 `handler_error`。
- FC 16 请求在同一个同步调用中连续写多个寄存器；需要合并通知的调用方可以用 `setImmediate` 合并（有测试保证这一点）。

## 3. 服务

- `create_tcp_server(host, port, unit_map, { rtu, unit_ids, handler })`：用 handler 创建 `Modbus_Server`，`unit_id` 取选项 `unit_ids`，缺省取 `unit_map.unit_ids`（es-modbus 在构造时把它复制为集合，之后新增的单元不会生效，所以单元要在创建服务前挂好）；`rtu` 传给 es-modbus 的同名选项；`handler` 选项缺省时用 `create_handler` 建立。
- `Modbus_Emulator` 在建好单元表后只建立一个 handler（`emulator.handler`），传给它的全部服务：handler 只按单元表查找、没有其他状态，共用后“未映射地址”的警告在全部服务中合计只报告一次，而不是每个服务各报告一次。handler 依赖单元表并保存已报告地址的集合，所以不能放在模块顶层，否则同一进程内的多个模拟器会互相串用。
- `create_rtu_server(path, unit_map, { baud_rate, parity, data_bits, stop_bits, unit_ids, handler })`：`unit_ids` 同上；`port` 取串口路径，es-modbus 据此选 RTU 传输；构造时检查参数，`start()` 才打开串口，所以构造不需要硬件。
- 工厂不给服务添加监听器：服务的事件就是 es-modbus 原有的，由调用方监听，包括 `error`。

## 4. Modbus_Emulator

- 构造：`source` 是路径或路径列表，每个文件用 `yaml` 解析；列表项也可以是对象，这是给控制器按自己的配置拼出描述用的内部入口，不属于公开接口（规范和类型声明只写文件路径），其中相对的 `layouts_file` 相对于当前目录；从每个文件取出根键 `blocks`、`servers`、`layouts_file`：`blocks` 和 `servers` 按文件顺序连接（有多个文件时，出错信息带文件名前缀），`layouts_file` 相对于它自己所在的文件，文件的其余部分（`layouts` 与片段，如有）原样作为一个来源；这些来源和布局文件作为同一次 `layout-data` `register_layout` 调用的来源，一并注册（`blocks` 和 `servers` 不会传给它，否则会被当成片段）；没有来源时模拟器不注册，数据块使用进程里已注册的布局。
- 校验收集全部违规项后一次抛出：无法读取的文件、布局错误、数据块（未知键、`unit_id` 范围、`start` 与 `offset` 为偶数、名称重复、布局是否存在）、服务（按协议检查未知键、协议、端口范围、端口已被前面的服务使用、`unit_ids` 的格式，以及其中的单元号是否有数据块，后者在数据块读完后检查）。布局注册失败时，layout-data 一个布局也不注册，因此不检查数据块的布局是否存在：否则每个数据块都会重复报错，淹没真正的错误。
- 每个数据块创建一个 Ldata 并挂到单元表；布局由模拟器注册（`register_layout` 每个进程只能成功调用一次，所以每个进程一个模拟器），数据块按布局名创建（`new Ldata(布局名, 数据块名)`）；每个服务创建一个 `Modbus_Server`，共用同一单元表。
- `start(options)` 并行启动全部服务，用 `Promise.allSettled` 等每个服务都有结果后再处理失败。它依赖 es-modbus 的这些行为：同一服务的 `start` / `stop` 在内部排队执行；`stop()` 等前面的 `start` 结束后才执行，且从不 reject；对没有启动过的服务调用 `stop()` 立即返回；对运行中的服务调用 `start()` 会先停再启。因此缺省模式下有失败就对全部服务调用 `stop()`，包括调用前已在运行的服务（对它们而言 `start()` 本就是重启），然后抛出；`partial` 模式下已启动的服务保持运行。两种模式抛出同样的 `AggregateError`，失败不会被忽略，只在“是否停掉其他服务”上不同。
- 服务标签在构造时保存：服务在描述中的位置（`servers[i]`，有多个文件时带文件名前缀）和地址（`modbus://host:port`、`rtu://host:port`、`serial://path`），用于在 `start()` 的错误和转发的服务事件载荷中标明服务。
- `stop()` 用 `Promise.all` 并行停止全部服务。
- 事件：`Modbus_Emulator` 继承 `EventEmitter`。建立服务后订阅它的 es-modbus 事件，把每个 `<name>` 以 `server_<name>` 重新发出，载荷为 `{ server, label }`，再加上 `socket` 或 `error` 参数；订阅 handler 的事件并原样重新发出。它对 `error` 的监听使服务的错误不会抛出，它自身也不发出 `error`，所以没有监听器的模拟器不会因事件而抛出异常。
- 构造期发现的诊断信息发生在调用方能挂监听器之前，所以不发出事件，而是收入 `warnings`（字符串数组）。

## 5. 构建与测试

- `pnpm build`：rolldown 把 `src/index.js` 打包为 `dist/modbus_emulator.js`；
- `pnpm test`：先构建，再 `node --test`；测试导入 `src`，另有一个打包产物的冒烟测试，核对 `dist` 的导出与 `src` 一致、layout-data 保持外部依赖、能为主站提供服务；测试用 es-modbus 的 `Modbus_Client` 作主站；被测的 TCP 服务监听端口 0，测试读取系统选定的端口，避免探测与监听之间端口被其他进程占用；RTU 串口只测构造；
- `pnpm lint`：ESLint。
