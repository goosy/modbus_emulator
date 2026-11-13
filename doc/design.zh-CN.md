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
| `dist/index.js` / `dist/index.d.ts` | `src/index.js` 的打包文件和 `src/index.d.ts` 的副本，由构建生成（`rolldown.config.js`，第 5 节）；发布的就是这两个文件，不提交到仓库 |

依赖：

- `layout-data`（布局登记域与 Ldata）：运行时依赖，不打包。数据块的 Ldata 对象会交到调用方手里，如果在这里打包一份，就会和调用方自己的那份并存，各有各的登记域。
  - `src/index.js` 转发调用方用到的那部分接口（`export ... from "layout-data"`：`Ldata`、`Ltag`、`create_scope`、`get_scope`、`yaml`、`desc_file`；类型在 `src/index.d.ts`），调用方从本包导入，进程里就只有一份。其余的布局接口是登记域对象和布局对象的方法，不需要转发。
- `es-modbus`：运行时依赖，不打包。本包是给其他包依赖的，不是应用，所以不打包它。
  - 使用本包的应用把它统一打包一次：未用到的 `Modbus_Client` 随之去掉，共用的代码只有一份，串口原生模块的 `prebuilds` 目录也只有一处（原生模块到包含它们的打包文件旁边查找；es-modbus 作为包安装时，找的就是它自己的 `prebuilds` 目录）。
  - `Modbus_Server` 在 `src/index.d.ts` 里声明为调用方用到的小接口，因为 es-modbus 没有类型声明。
- 发布：本包发布自身源文件的打包文件，依赖在其中保持为 `import`（第 5 节）。

## 2. Unit_Map 与 handler

- `Unit_Map` 内部用私有的 `Map` 保存单元号到该单元各段的映射，单元不是实例自身的属性。`attach_unit(unit_id, block, start, offset)` 检查 `start` 与 `offset` 是否为偶数非负整数，这样自行装配单元表的调用方也能得到与模拟器同样的检查；然后按 `start` 把段 `{ block, start, offset, end: start + size - offset }` 插入到合适的位置。插入前检查新段与相邻两段都不重叠：同一单元的段已排序且互不重叠，只有相邻的段可能与新段重叠。重叠时抛出 `Error`，指明两个数据块，单元表保持不变。一个单元可以挂多个 Ldata。
- 各单元的字节序保存在另一个私有的 `Map` 中，由 `set_endian` 写入；对其中没有的单元，`get_endian` 返回 `BE`。`set_endian` 检查单元号是否为 0..255 的整数、字节序是否在本模块的 `ENDIANS` 列表中（layout-data 的 `check_endian` 是内部函数，不能调用），不合格时抛出 `RangeError`。它在单元挂上数据块之前或之后调用都可以；只设置了字节序、还没有数据块的单元不会出现在 `unit_ids` 中，`unit_ids` 仍只列出有段的单元。
- 段的字节序：单元的字节序不是 `BE` 时，它的每一段都配一张表 `io_to_block`，`io_to_block[j]` 是 IO 缓冲区第 `j` 个字节对应的数据块字节，即 `block.layout.io_index_table(endian)` 的逆映射。这些表存放在本模块的一个 `WeakMap` 中，以段为键，因此 `segments()` 返回的仍是 spec 规定的结构。`BE` 的段不需要表，IO 字节就是数据块的字节。`attach_unit` 按单元当前的字节序建表，`set_endian` 则为该单元已有的每一段重建表。表只取决于布局和字节序，数据块在被服务期间这两者都不会变，所以每段只算一次。handler 读写时逐字节查表，从不整体转换数据块：不保存 IO 缓冲区的副本，调用方经 Ldata 写入时也就不需要同步。
- `resolve(unit_id, byte)` 用二分查找找出 `start` 不大于 `byte` 的最后一段，`byte` 小于该段的 `end` 时即为已映射；返回的偏移是 IO 缓冲区中的偏移 `byte - start + offset`。handler 对每个点都用同样的查找来定位，同时取得该段的表。
- `create_handler(unit_map)` 返回 es-modbus 要求的 handler，方法名为：`get_holding_register`、`get_input_register`、`set_holding_register`、`get_coil`（同时用于 FC 1 和 FC 2）、`set_coil`，以及批量方法 `get_holding_registers` / `get_input_registers` / `get_coils` / `set_holding_registers` / `set_coils`：es-modbus 对一次 FC 3 / FC 4 / FC 1 与 FC 2 / FC 16 / FC 15 请求只调用一次，而不是每个点一次。有了批量读，es-modbus 就不再调用逐点读；保留逐点读，是为了直接调用 handler 的其他程序。handler 是 `EventEmitter`（`Object.assign(new EventEmitter(), methods)`）。
- 寄存器 `addr` 对应单元的 IO 字节 `addr * 2`，线圈 `addr` 对应 IO 字节 `addr >> 3` 的第 `addr % 8` 位。layout-data 的布局总是整数个寄存器，而任何字节序都只会把一个寄存器的两个 IO 字节映射到数据块中同一个寄存器的两个字节上，顺序可能不变，也可能互换。所以一个寄存器对应数据块中从 `min(io_to_block[j], io_to_block[j + 1])` 开始的两个字节，`io_to_block[j]` 较大时表示互换；用 `read_bytes` 读出后，不互换时按大端解码，互换时按小端解码。线圈对应数据块字节 `io_to_block[j]` 的第 `addr % 8` 位，位掩码不变，因为任何字节序都不会移动字节内部的位。
- 写入都经过 Ldata 的 `write_bytes` / `write_bit`，由 Ldata 在每次写入后检测变化；除此之外无法直接访问 Ldata 的字节。
- FC 6 / FC 5 调用逐点写：写一个寄存器是一次两字节的 `write_bytes`。这两个字节放在一个共用的两字节数组里，`write_bytes` 会立即复制它们，所以可以共用。
- 未映射的地址读为 0 / false，写入被忽略；每个（类型、单元、地址）只发出一次 `unmapped`，避免轮询时淹没监听器。已报告的地址记在一个最多 1024 项的集合中（`MAX_UNMAPPED_REPORTS`），否则主站扫描整个地址空间时它会增长到 65536 × 3 × 256 项；集合满后发出一次 `unmapped_limit`，之后的地址既不发出也不记录。
- 请求先由 es-modbus 校验；handler 抛出异常时，es-modbus 应答 0x04，并在服务上发出 `handler_error`。
- 批量写把请求切分为若干组：相邻的点属于同一个块、块内偏移连续，寄存器还要都互换或都不互换，就归为一组；未映射的点报告后跳过。`BE` 和 `BEBS` 下，数据块中寄存器的顺序与地址顺序一致，所以一次请求在每个块上仍只有一组；`LE` 和 `LEBS` 下，4 字节数值的两个寄存器顺序颠倒，会分成同一块中的两组。一次请求写到几个块，就为每个块开一个 `transaction`，并把它们层层嵌套：地址最高的块的事务在最外层，地址最低的在最内层。内层的事务先提交，所以各块的事件按地址从低到高的顺序发出。全部写入都在最内层的事务中进行：寄存器每组调用一次 `write_bytes`；线圈用 `write_bit`，每个字节最多调用两次（一次置位、一次清零），所以 `access` 只报告实际写到的 Bool。同一个块在一次请求中被写到两次，也只开一个事务。
- 批量读用同样的方式切分请求，也在同样嵌套的事务中读取：寄存器每组调用一次 `read_bytes`，线圈每个调用一次 `read_bit`，所以 `access` 只报告被读的 Bool；未映射的点读为 0 / false。每个事务把本块的 `access` 汇总起来，在提交时发出一次。
- 写入本身抛出异常时，全部事务回滚，异常交给 es-modbus（应答 0x04）。监听器在提交时抛出的异常则不同：`transaction` 把其中第一个重新抛出，handler 等全部写入完成后再捕获它，作为 `listener_error` 发出（载荷 `{ block, error }`）；其余的块照常提交，主站收到正常应答。

## 3. 服务

- `create_tcp_server(unit_map, { host, port, rtu, unit_ids, handler, name })`：用 handler 创建 `Modbus_Server`。传给 es-modbus 的 `unit_id` 选项取自 `unit_ids`，缺省为 `unit_map.unit_ids`。es-modbus 在构造时把它复制成自己的集合，所以从创建起，服务的单元列表就与单元表无关：缺省值是创建时单元表里的单元，`attach_unit` 不会改变它，只有服务的 `set_unit_ids` 能改变它。这是有意的：单元表是数据，服务应答哪些单元是服务的配置。`rtu` 传给 es-modbus 的同名选项；没有给出 `handler` 选项时用 `create_handler` 建立。
- `Modbus_Emulator` 在构造时用自己的单元表建立唯一的 handler（`emulator.handler`），各次装入的全部服务都用它。handler 只在单元表中查找，没有别的状态；全部服务共用它，同一个未映射地址在全部服务中合计只报告一次，而不是每个服务各报一次。handler 依赖单元表，又保存着已报告地址的集合，所以不能放在模块顶层，否则同一进程中的多个模拟器会共用同一个 handler。
- `create_rtu_server(path, unit_map, { baud_rate, parity, data_bits, stop_bits, unit_ids, handler, name })`：`unit_ids` 同上；串口路径作为 `port` 选项传入，es-modbus 据此选用 RTU 传输；构造时检查参数，`start()` 才打开串口，所以构造不需要硬件。
- 工厂不给服务添加监听器：服务的事件就是 es-modbus 原有的，由调用方监听，包括 `error`。

## 4. Modbus_Emulator

- 构造：构造方法接受登记域名称，缺省为 `modbus_emulator`（`DEFAULT_SCOPE`），把登记域 `get_scope(name) ?? create_scope(name)` 保存为 `scope`（名称不是标识符时 `create_scope` 的错误原样抛出），并建立 handler（§3）。它不读描述：调用方挂上监听器后再调用 `load`。
- 读取：`load(sources)` 接受一个来源或来源列表。字符串或 `URL` 的来源是描述文件，用 layout-data 的 `desc_file` 读取并编译（YAML 1.2，连同其 `imports` 中的文件）；它的错误信息已经指明文件，原样收集；`TypeError`（URL 不是 `file:` URL）则收集其消息。其他来源视为调用方用 `desc_file` 或 `yaml` 编译的 `Description`；缺少 `layouts` 对象或 `blocks` 列表（每个 `Description` 都有这两项）就是错误（`not a description file or a Description`），其他不是 `Description` 的对象由登记域的 `load` 拒绝。不提供普通对象的入口：这样的对象用 `yaml(JSON.stringify(object))` 编译。数据块取自 `Description` 的 `blocks`；`units` 和 `servers` 是根键，`Description` 会原样保留解析出的、layout-data 不认识的根键；这两个键给出时都必须是列表。`blocks`、`units` 和 `servers` 按来源顺序连接，所以布局文件与其他来源一样是列表的一项。有多个来源时，本包的出错信息带来源前缀：文件用其路径（`file:` URL 转为路径），`Description` 用 `description #N`，与 layout-data 对列表项的称呼相同；错误的标题也这样列出各来源。读完全部来源后，只要有编译失败就结束本次装入，因为没有可以检查的数据块。各来源既没有数据块也没有服务时是错误。条目接着先前装入的数据块、单元和服务编号（`blocks[this.blocks.size + i]`；`units[this.unit_map.unit_ids.length + i]`，因为已装入的每个单元条目恰好对应单元表中一个有数据块的单元；`servers[this.servers.length + i]`），服务的标签因此在模拟器中保持唯一。读取单元条目时，按块名在它所在的 `Description` 的数据块中查找，所以单元条目只能放置本描述的数据块。数据块的大小取其 `Description` 中布局的 `size`（`Description.layouts[entry.layout]`）：这个布局在装入之前已由 `desc_file` 或 `yaml` 编译好，大小与登记域将要持有的布局相同。
- 登记域：一次装入的全部已编译描述，交给登记域的一次 `load` 调用。它注册布局（指纹和名称都相同的布局复用已有的），并建立数据块的 Ldata，要么全部成功，要么全部不生效；它的错误被收集。本包不另设布局表，布局的复用完全由 layout-data 在登记域内完成。
- 校验分阶段进行，收集全部违规项后一次抛出；所有校验都在登记域的 `load` 之前，所以失败的装入既不改变模拟器，也不改变登记域。读取：既不是文件也不是 `Description` 的来源、无法读取的文件和文件的编译错误，其中包括 layout-data 检查的数据块错误（`name` 为字符串、在本描述中唯一，`layout` 为本描述列出的布局）。条目：服务（按协议检查未知键、协议、端口范围、`rtu` 的串口参数（取值与 es-modbus 接受的一致）、端口已被本次或先前装入的服务使用、`unit_ids` 的格式）、数据块条目（出现 `name` 和 `layout` 以外的键）和单元（单元条目或放置中的未知键；`unit_id` 超出范围、在本次装入中重复或与模拟器已有的单元相同；`endian` 不是四种字节序之一；`blocks` 不是非空对象；`start` 或 `offset` 不是偶数；块名不是该单元所在描述中的数据块；数据块被放置两次；描述中有数据块没有被本描述的任何单元放置）；条目有错误时，本次装入在此结束，因为无法放置其数据块。放置：数据块放在一张临时的 `Unit_Map` 上，它先取模拟器单元表的各段，再按单元条目的顺序，为本次的每个放置挂上 `{ name, size }`；重叠因此就是 `attach_unit` 报出的错误（前缀为该放置的位置 `units[i].blocks.<name>`），不必另写重叠检查。临时表不设字节序：字节序不影响字节区间，而且建表需要真实数据块的布局，`{ name, size }` 没有布局；与模拟器已有数据块同名是错误（layout-data 只检查一个布局内、一次调用内的块名，而 `blocks` 以块名为键）；`unit_ids` 中的每个单元在临时表上必须有数据块。装入：登记域 `load` 的错误（与登记域中已有布局冲突的布局、与其布局已有 ldata 同名或在两个描述中给出的数据块名）。这是最后一个可能失败的步骤，它本身要么全部成功、要么全部不生效。放置的错误先于装入的错误报出，不在同一次抛出中。
- 登记域的 `load` 成功后不会再失败。`load` 为每个数据块建立了一个 Ldata，模拟器按数据块条目的顺序把它们加入 `blocks`，并把其名称记为已持有（`stop()` 交还的就是这些名称）。然后逐个处理单元条目：先设置单元的字节序（给出 `endian` 时调用 `set_endian`），再按放置的顺序挂上数据块。字节序先于挂载设置，所以每段的表只在挂载时建立一次。`load` 结果中的 `layouts` 并入模拟器的 `layouts`。接着，对先前装入的、未写 `unit_ids` 的服务调用 `set_unit_ids(unit_map.unit_ids)`：工厂只在创建服务时复制单元表中的单元，这样“全部单元”才会随每次装入更新。本次装入的每个服务条目创建一个 `Modbus_Server`，都使用同一个单元表；记下它的地址，供之后的装入检查端口；未写 `unit_ids` 的服务也记下来，供以后做上面的更新。`load` 返回本次新增的数据块和服务；它是同步的，不启动服务。
- `start(options)` 在模拟器没有服务时抛出。它启动尚未启动的服务，由模拟器记录哪些已启动：es-modbus 对运行中的服务调用 `start()` 是重启（断开连接、关闭监听或串口，再重新打开），所以不对运行中的服务调用 `start()`。这些服务并行启动，用 `Promise.allSettled` 等每个服务都有结果后再处理失败。它依赖 es-modbus 的这些行为：同一服务的 `start` / `stop` 在内部排队执行；`stop()` 等前面的 `start` 结束后才执行，且从不 reject；对没有启动过的服务调用 `stop()` 立即返回；对运行中的服务调用 `start()` 会先停再启。因此缺省模式下有失败就对全部服务调用 `stop()`，包括调用前已在运行的服务，然后抛出；`partial` 模式下已启动的服务保持运行。两种模式抛出同样的 `AggregateError`，失败不会被忽略，只在“是否停掉其他服务”上不同。
- 服务标签由服务在已装入描述中的位置（`servers[i]`，一次装入有多个来源时带来源前缀）和地址（`modbus://host:port`、`rtu://host:port`、`serial://path`）组成，作为 es-modbus 的 `name` 选项交给服务，此后由服务自己携带：`start()` 的错误和转发事件的监听器都读取 `server.name`，模拟器不再另存一份标签列表。
- `stop()` 用 `Promise.all` 并行停止全部服务，清除已启动的记录，然后把它持有的名称交还给其布局（`block.layout.delete_ldata(name)`）。只交还持有的名称，从不交还先前已交还的名称：它此后可能已被另一个模拟器持有。Ldata 照常可用并留在 `blocks` 中，`start()` 会再次服务它们；它们的名称可供同一登记域中布局相同的另一个模拟器使用。
- 事件：`Modbus_Emulator` 继承 `EventEmitter`。建立服务后订阅它的 es-modbus 事件，把每个 `<name>` 以 `server_<name>` 重新发出，载荷为 `{ server }`，再加上 `socket`、`error` 或 `frame` 参数；也订阅 handler 的事件，原样重新发出。模拟器始终监听服务的 `error`，所以服务的错误不会抛出；它自己也不发出 `error`，因此没有监听器的模拟器不会因事件而抛出异常。
- 装入的诊断信息作为 `warning` 事件发出（载荷 `{ server, message }`），因为调用方在构造之后、装入之前就已挂上监听器。对本次装入的、协议不是 `tcp` 的服务（协议不是 `tcp` 时，es-modbus 把 unit 0 当作广播地址），检查它应答的单元（其 `unit_ids`，或单元表中的全部单元）中是否有 unit 0 或 248..255；对先前装入的、未写 `unit_ids` 的这类服务，检查本次新增的单元。每个服务每类问题给一条警告，消息以服务的名称开头。

## 5. 构建与测试

- `pnpm build`：`rolldown -c`；`rolldown.config.js` 加载时清空 `dist`，把 `src/index.js` 打包为 `dist/index.js`（`platform: "node"`、`format: "es"`、单个文件）；`external` 是 `package.json` 的 `dependencies` 的包名（及其子路径）和带 `node:` 前缀的内置模块，所以 `layout-data` 和 `es-modbus` 在打包文件里保持为 `import`；配置中的一个插件把 `src/index.d.ts` 原样输出为 `dist/index.d.ts`，因为类型声明是手写的，不引用本包的其他文件；
- 发布：`package.json` 的 `files` 是 `dist` 和 `CHANGELOG.md`；`exports` 的 `default` 指向 `dist/index.js`，`types` 指向 `dist/index.d.ts`；`prepare` 执行构建，所以从仓库或工作区安装后、打包发布前打包文件都已存在；
- `pnpm test`：先构建，再执行 `node --test`（全部测试，针对 `src`）和 `pnpm test:dist`（全部测试再跑一遍，针对打包文件）；测试只用公开接口，从 `test/target.js` 取得：默认是 `src` 的入口；先导入 `test/dist.js` 时（`node --test --import ./test/dist.js`）则按包名导入本包，即 `dist` 里的打包文件，`dist.js` 设置环境变量 `MODBUS_EMULATOR_TEST_TARGET=dist`，传给各测试文件的进程；打包测试（`test/bundle_test.js`）核对 `exports` 指向 `dist` 的文件、打包文件导出的名字与 `src` 入口相同、其 `import` 只有 `layout-data`、`es-modbus` 和 `node:` 模块；测试用 es-modbus 的 `Modbus_Client` 作主站；被测的 TCP 服务监听端口 0，测试读取系统选定的端口，避免探测与监听之间端口被其他进程占用；es-modbus 的选项不接受端口 0，测试先以固定端口构造服务，在 `start()` 之前再把其 `port` 设为 0（`test/helpers.js` 的 `ephemeral`），与 es-modbus 自身的测试相同；RTU 串口只测构造；
- `pnpm lint`：ESLint。
