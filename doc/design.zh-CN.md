# modbus-emulator 设计

> 需求见 [spec.zh-CN.md](spec.zh-CN.md)。本文说明实现。

## 1. 源文件

| 文件 | 职责 |
| --- | --- |
| `src/index.js` | 包的公开接口，含转发的 layout-data 接口 |
| `src/unit_map.js` | `Unit_Map` 与 es-modbus 的服务端 handler |
| `src/server.js` | `create_tcp_server`、`create_rtu_server` |
| `src/emulator.js` | `Modbus_Emulator`：装入描述、建立数据块和服务 |
| `src/index.d.ts` | 公开接口的类型声明（手写） |

依赖：

- `layout-data`（布局登记域与 Ldata）：运行时依赖，保持外部引用。数据块的 Ldata 对象会交到调用方手里，如果在这里打包一份，就会和调用方自己的那份并存，各有各的登记域。
  - `src/index.js` 转发调用方用到的那部分接口（`export ... from "layout-data"`：`Ldata`、`Ltag`、`create_scope`、`get_scope`、`yaml`、`desc_file`；类型在 `src/index.d.ts`），调用方从本包导入，进程里就只有一份。其余的布局接口是登记域对象和布局对象的方法，不需要转发。
- `es-modbus`：运行时依赖，保持外部引用。本包是给其他包依赖的，不是应用，所以不打包它。
  - 使用本包的应用把它统一打包一次：未用到的 `Modbus_Client` 随之去掉，共用的代码只有一份，串口原生模块的 `prebuilds` 目录也只有一处（它们在持有它们的包旁边查找；作为包安装时就是 es-modbus 自己的 `prebuilds` 目录）。
  - `Modbus_Server` 在 `src/index.d.ts` 里声明为调用方用到的小接口，因为 es-modbus 没有类型声明。
- 发布：本包原样发布 `src`，没有构建步骤。打包是应用的事，给本包打包只会把它自己的源文件合并起来。
- 版本与联调：
  - `layout-data` 锁定为已发布的版本号。
  - 联调尚未发布的依赖（layout-data、es-modbus）时，只用 yalc 临时引用（`file:.yalc/<name>`），它按普通依赖安装发布内容；提交和发布前必须改回版本号。
  - 不要用 pnpm 的 `link:`：它从依赖自己的仓库目录解析模块，会使调用方对同一个模块出现两个实例。

## 2. Unit_Map 与 handler

- `Unit_Map` 内部用私有的 `Map` 保存单元号到该单元各段的映射，单元不再是实例自身的属性。`attach_unit(unit_id, block, start, offset)` 检查 `start` 与 `offset` 为偶数非负整数，使自行装配单元表的调用方与模拟器受到同样的保护，并按 `start` 把段 `{ block, start, offset, end: start + size - offset }` 插入到位。插入前检查新段与相邻两段都不重叠：同一单元的段已排序且互不重叠，只有相邻的段可能与新段重叠。重叠时抛出 `Error`，指明两个数据块，单元表保持不变。一个单元可以挂多个 Ldata。
- `resolve(unit_id, byte)` 用二分查找找出 `start` 不大于 `byte` 的最后一段，`byte` 小于该段的 `end` 时即已映射。handler 对每个点都经它查找。
- `create_handler(unit_map)` 返回 es-modbus 要求的 handler，方法名为 snake_case：`get_holding_register`、`get_input_register`、`set_holding_register`、`get_coil`（同时用于 FC 1 和 FC 2）、`set_coil`，以及批量方法 `get_holding_registers` / `get_input_registers` / `get_coils` / `set_holding_registers` / `set_coils`：es-modbus 对一次 FC 3 / FC 4 / FC 1 与 FC 2 / FC 16 / FC 15 请求只调用一次，而不是每个点一次。有批量读时 es-modbus 不再调用逐点读，逐点读留给 handler 的调用方。handler 是 `EventEmitter`（`Object.assign(new EventEmitter(), methods)`）。
- 寄存器 `addr` 对应字节 `addr * 2`，按大端用 Ldata 的 `read_bytes` 读取；线圈 `addr` 对应字节 `addr >> 3` 的第 `addr % 8` 位。
- 写入经 Ldata 的 `write_bytes` / `write_bit`，由 Ldata 在每次写入后检测变化；Ldata 的字节不能以其他方式访问。
- FC 6 / FC 5 调用逐点写：写一个寄存器是一次两字节的 `write_bytes`，字节取自共用的两字节数组，`write_bytes` 立即复制。
- 未映射的地址读为 0 / false，写入被忽略；每个（类型、单元、地址）只发出一次 `unmapped`，避免轮询时淹没监听器。已报告的地址记在一个最多 1024 项的集合中（`MAX_UNMAPPED_REPORTS`），否则主站扫描整个地址空间时它会增长到 65536 × 3 × 256 项；集合满后发出一次 `unmapped_limit`，之后的地址既不发出也不记录。
- 请求由 es-modbus 先行校验：handler 抛出异常时应答 0x04，es-modbus 在服务上发出 `handler_error`。
- 批量写把请求切分为段：同一个块中偏移连续的相邻点为一段；未映射的点报告后跳过。写到的块在嵌套的 `transaction` 中写入，地址最高的块在最外层，内层先提交，事件因此按地址顺序发出。在最内层中，寄存器每段一次 `write_bytes`；线圈用 `write_bit`，每个字节按值各一次（置位的位、清零的位），因此 `access` 只报告被写的 Bool。同一个块被写到两次时只开一个事务。
- 批量读按同样方式切分请求，在同样嵌套的事务中读取：寄存器每段一次 `read_bytes`，线圈每个一次 `read_bit`，因此 `access` 只报告被读的 Bool；未映射的点读为 0 / false。每个事务累积本块的 `access`，提交时发出一次。
- 写入抛出异常时，全部事务回滚，异常交给 es-modbus（应答 0x04）。`transaction` 在提交时重新抛出监听器抛出的第一个异常；handler 在全部写入完成后捕获它，作为 `listener_error` 发出，载荷 `{ block, error }`，其余的块照常提交，主站收到正常应答。

## 3. 服务

- `create_tcp_server(unit_map, { host, port, rtu, unit_ids, handler, name })`：用 handler 创建 `Modbus_Server`，`unit_id` 取选项 `unit_ids`，缺省取 `unit_map.unit_ids`（es-modbus 在构造时把它复制为集合，所以服务的列表从创建起就与单元表相互独立：缺省值是那时单元表中的单元，`attach_unit` 从不改变它，只有服务的 `set_unit_ids` 能改变它。单元表与服务应答的单元有意分开：前者是数据，后者是服务的配置）；`rtu` 传给 es-modbus 的同名选项；`handler` 选项缺省时用 `create_handler` 建立。
- `Modbus_Emulator` 在构造时基于其单元表只建立一个 handler（`emulator.handler`），传给它各次装入的全部服务：handler 只按单元表查找、没有其他状态，共用后“未映射地址”的警告在全部服务中合计只报告一次，而不是每个服务各报告一次。handler 依赖单元表并保存已报告地址的集合，所以不能放在模块顶层，否则同一进程内的多个模拟器会互相串用。
- `create_rtu_server(path, unit_map, { baud_rate, parity, data_bits, stop_bits, unit_ids, handler, name })`：`unit_ids` 同上；`port` 取串口路径，es-modbus 据此选 RTU 传输；构造时检查参数，`start()` 才打开串口，所以构造不需要硬件。
- 工厂不给服务添加监听器：服务的事件就是 es-modbus 原有的，由调用方监听，包括 `error`。

## 4. Modbus_Emulator

- 构造：构造方法接受登记域名称，缺省为 `modbus_emulator`（`DEFAULT_SCOPE`），把登记域 `get_scope(name) ?? create_scope(name)` 保存为 `scope`（名称不是标识符时 `create_scope` 的错误原样抛出），并建立 handler（§3）。它不读描述：调用方挂上监听器后再调用 `load`。
- 读取：`load(sources)` 接受一个来源或来源列表。字符串或 `URL` 的来源是描述文件，用 layout-data 的 `desc_file` 读取并编译（YAML 1.2，连同其 `imports` 中的文件）；其错误本身已指明文件，原样收集，`TypeError`（不是 `file:` URL）收集其消息。其他来源视为调用方用 `desc_file` 或 `yaml` 编译的 `Description`；没有 `layouts` 对象或 `blocks` 列表（每个 `Description` 都有）是错误（`not a description file or a Description`），其他不是 `Description` 的对象由登记域的 `load` 拒绝。原先给控制器用的对象入口取消：这样的对象用 `yaml(JSON.stringify(object))` 编译。数据块取自 `Description` 的 `blocks`，其条目保留本包的键（`unit_id`、`start`、`offset`）；`servers` 是 `Description` 的根键，它原样保留解析出的其他根键。`blocks` 和 `servers` 按来源顺序连接，所以布局文件与其他来源一样是列表的一项。有多个来源时，本包的出错信息带来源前缀：文件用其路径（`file:` URL 转为路径），`Description` 用 `description #N`，与 layout-data 对列表项的称呼相同；错误的标题也这样列出各来源。读完全部来源后，有编译失败就结束本次装入：没有可以检查的数据块。各来源既没有数据块也没有服务时是错误。条目接着先前装入的数据块和服务编号（`blocks[this.blocks.size + i]`、`servers[this.servers.length + i]`），服务的标签因此在模拟器中保持唯一。数据块的大小取其 `Description` 中布局的 `size`（`Description.layouts[entry.layout]`），它由 `desc_file` 或 `yaml` 在装入之前编译，就是登记域将持有的布局的大小。
- 登记域：一次装入的编译后描述交给登记域的一次 `load` 调用，它注册布局（指纹与名称都相同的布局复用），并建立数据块的 Ldata，全部或全部不；其错误被收集。本包不另设表：布局的复用就是 layout-data 在一个登记域内的复用。
- 校验收集全部违规项后一次抛出，分阶段进行，全部先于登记域的 `load`，所以失败的装入既不改变模拟器也不改变登记域。读取：既不是文件也不是 `Description` 的来源、无法读取的文件和文件的编译错误，其中包括 layout-data 检查的数据块错误（`name` 为字符串、在本描述中唯一，`layout` 为本描述列出的布局）。条目：服务（按协议检查未知键、协议、端口范围、`rtu` 的串口参数（取值与 es-modbus 接受的一致）、端口已被本次或先前装入的服务使用、`unit_ids` 的格式）和数据块中属于本包的键（未知键、`unit_id` 范围、`start` 与 `offset` 为偶数）；数据块有错误时在此结束本次装入，因为这样的数据块无法放置。放置：数据块放在一张临时的 `Unit_Map` 上，它先取模拟器单元表的各段，再为本次的每个数据块放入 `{ name, size }`，重叠因此就是 `attach_unit` 的错误（前缀为该数据块条目），不另写重叠检查；与模拟器已有数据块同名是错误（layout-data 只检查一个布局内、一次调用内的块名，而 `blocks` 以块名为键）；`unit_ids` 中的每个单元在临时表上必须有数据块。装入：登记域 `load` 的错误（与登记域中已有布局冲突的布局、与其布局已有 ldata 同名或在两个描述中给出的数据块名），它是最后一个可能失败的步骤，本身全部或全部不。放置的错误先于装入的错误报出，不在同一次抛出中。
- 登记域的 `load` 之后不再有失败。它为每个数据块建立一个 Ldata，模拟器把它们挂到单元表，按条目顺序加入 `blocks`，并把其名称记为已持有（`stop()` 交还的就是这些名称）。结果中的 `layouts` 并入 `layouts`。然后对先前装入的、未写 `unit_ids` 的服务调用 `set_unit_ids(unit_map.unit_ids)`，因为工厂在创建服务时复制单元表的单元：“全部单元”因此随装入更新。本次的每个服务创建一个 `Modbus_Server`，共用同一单元表；记下其地址供之后装入的端口检查，未写 `unit_ids` 的服务记下供上面的更新使用。`load` 返回本次新增的数据块和服务；它是同步的，不启动服务。
- `start(options)` 在模拟器没有服务时抛出。它启动尚未启动的服务，由模拟器记录哪些已启动：es-modbus 对运行中的服务调用 `start()` 是重启（断开连接、关闭监听或串口，再重新打开），所以不对运行中的服务调用 `start()`。这些服务并行启动，用 `Promise.allSettled` 等每个服务都有结果后再处理失败。它依赖 es-modbus 的这些行为：同一服务的 `start` / `stop` 在内部排队执行；`stop()` 等前面的 `start` 结束后才执行，且从不 reject；对没有启动过的服务调用 `stop()` 立即返回；对运行中的服务调用 `start()` 会先停再启。因此缺省模式下有失败就对全部服务调用 `stop()`，包括调用前已在运行的服务，然后抛出；`partial` 模式下已启动的服务保持运行。两种模式抛出同样的 `AggregateError`，失败不会被忽略，只在“是否停掉其他服务”上不同。
- 服务标签，即服务在已装入描述中的位置（`servers[i]`，一次装入有多个来源时带来源前缀）和地址（`modbus://host:port`、`rtu://host:port`、`serial://path`），作为 es-modbus 的 `name` 选项交给服务。此后由服务自己携带：`start()` 的错误和转发事件的监听器都读取 `server.name`，模拟器不再另存一份标签列表。
- `stop()` 用 `Promise.all` 并行停止全部服务，清除已启动的记录，然后把它持有的名称交还给其布局（`block.layout.delete_ldata(name)`）。只交还持有的名称，从不交还先前已交还的名称：它此后可能已被另一个模拟器持有。Ldata 照常可用并留在 `blocks` 中，`start()` 会再次服务它们；它们的名称可供同一登记域中布局相同的另一个模拟器使用。
- 事件：`Modbus_Emulator` 继承 `EventEmitter`。建立服务后订阅它的 es-modbus 事件，把每个 `<name>` 以 `server_<name>` 重新发出，载荷为 `{ server }`，再加上 `socket`、`error` 或 `frame` 参数；订阅 handler 的事件并原样重新发出。它对 `error` 的监听使服务的错误不会抛出，它自身也不发出 `error`，所以没有监听器的模拟器不会因事件而抛出异常。
- 装入的诊断信息作为 `warning` 发出，载荷 `{ server, message }`：调用方在构造之后已挂上监听器。对本次装入的、协议不是 `tcp` 的服务（协议不是 `tcp` 时，es-modbus 把 unit 0 当作广播地址），检查它应答的单元（其 `unit_ids`，或单元表中的全部单元）是否含 unit 0 和 248..255，对先前未写 `unit_ids` 的这类服务检查本次增加的单元，每个服务每类各给一条警告；消息以服务的名称开头。

## 5. 构建与测试

- `pnpm test`：`node --test`；测试导入 `src`，即本包发布的内容；另有一个测试按包名导入本包，核对 `exports` 解析到 `src`；测试用 es-modbus 的 `Modbus_Client` 作主站；被测的 TCP 服务监听端口 0，测试读取系统选定的端口，避免探测与监听之间端口被其他进程占用；RTU 串口只测构造；
- `pnpm lint`：ESLint。
