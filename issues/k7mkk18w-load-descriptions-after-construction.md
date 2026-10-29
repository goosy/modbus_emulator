---
id: k7mkk18w
opened: 2026-10-28T17:28:21.928Z
closed:
title: 构造只建实例，描述由 emulator.load 多次加载，全部检查先于 scope.load
status: accepted    # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

`new Modbus_Emulator(descriptions, scope)` 在构造时加载全部描述，加载只有这一次。这是旧 layout-data「每个登记域只注册一次」规则留下的形状，该规则已经删除（layout-data issue#yxhoe1w3）：`scope.load` 可以多次调用，布局按指纹复用。于是：

- 构造函数同时负责建实例和加载描述，一个 emulator 的块与服务只能在构造时一次给齐，之后无法追加；
- 检查发生在构造之中，此时实例尚未交给调用方，还不能挂监听，诊断只能放进 `warnings` 数组，而不能作为事件发出。只有构造先完成、检查在其后的加载中进行，才能用事件报告；
- 构造的顺序是：取得调用方编译好的 `Description`（检查每项都是 `Description`，连接各描述的 `blocks` 和 `servers`）→ 检查服务与块的本包键 → `scope.load` → `#attach_blocks`（`attach_unit` 检查同一单元内的重叠）→ `#check_server_units`（`unit_ids` 中的单元必须有块）。后两步出错时 `load` 已经生效，构造函数要调用 `#release_blocks` 把块名交还给布局，否则同样的描述不能再次构造；本次注册的新布局则留在登记域中，layout-data 无法注销（doc/design.md 的 Validation 一段专门写明了这一点）。失败的构造改变了登记域。

issue#7w2awj10 以两条理由拒绝了拆分构造函数，两条都已不成立：

- 「块的放置检查需要块大小，块大小来自布局的编译，全部校验先于注册做不到」：layout-data 的 `desc_file` 在读入时就编译出布局（layout-data issue#yxhoe1w3），`Description.layouts[name].size` 在 `load` 之前可用（已用脚本验证）；
- 「同一进程内重新构造不是要支持的场景」：它依赖的「每进程只注册一次」已不存在（issue#99agfr7m）。

## 解决提案

- 接口：`new Modbus_Emulator(scope = "modbus_emulator")` 只取得或创建登记域、建 handler，不读描述；`emulator.load(sources)` 加载一个来源或一组来源，可以调用任意多次，返回本次新增的 `{ blocks, servers }`。
- 来源：每个来源是一个 `Description`（由 `desc_file` 或 `yaml` 编译），或一个描述文件（路径字符串或 `file:` URL，与 `desc_file` 的参数相同），一组来源中两者可以混用。文件由本包用 `desc_file` 编译，其错误已指明文件，并入本次 `load` 的 `errors`，所以读取和编译的失败也全有或全无；全部来源编译后，作为一个 `Description` 列表交给 `scope.load`。本包自己的检查的出错信息前缀：文件用其路径，`Description` 用 `description #N`（N 为它在这组来源中的位置），只有一个来源时不加前缀。其他类型的来源是违例。
- 每次 `load` 对 emulator 全有或全无：违例收集齐后一起抛出（带 `errors` 的 `Error`），`blocks`、`unit_map`、`servers`、`layouts` 与登记域都保持调用前的状态。为此全部检查先于 `scope.load`：
  - 每个块的大小取自其描述的 `Description.layouts[block.layout].size`，以 `{ name, size }` 在一张临时的 `Unit_Map` 上做重叠检查，`unit_ids` 的检查也在这张表上做；
  - `scope.load` 成为最后一个可能失败的步骤，它本身全有或全无；之后把真正的块挂到单元表、建服务，这些步骤不会再失败；
  - 失败时不再调用 `#release_blocks`（`stop()` 仍用它）；doc/design.md 与 doc/spec.md 中「失败后布局留在登记域」「失败后交还块名」的说明随之修改；
  - 重叠与单元的错误先于 `scope.load` 报出，不再与它的错误（布局冲突、块名已被占用）在同一次报出，与现在块键错误先于 `load` 单独报出的做法一致。
- 跨次加载的检查，现在只在一次构造内成立，改为对 emulator 的全部状态（临时表由当前单元表的块加上本次的块构成）：
  - 块名：layout-data 只保证块名在一个布局内、在一次 `load` 调用内唯一，两次加载可能在不同布局上建出同名块，而 `blocks` 以块名为键。块名与 emulator 已有的块重名是违例；
  - 重叠：新块与单元表中已有的块重叠是违例；
  - 端口：TCP 地址或串口路径与已有的服务相同是违例；
  - `unit_ids`：其中的单元在本次加载后必须有块。
- 未写 `unit_ids` 的服务应答单元表的全部单元，但 `create_tcp_server` / `create_rtu_server` 在建服务时取的是当时单元表的快照，后加载的单元不会被应答。每次 `load` 之后，对未写 `unit_ids` 的服务调用 `set_unit_ids(unit_map.unit_ids)`，使「全部单元」随加载更新。
- 「`blocks`、`servers` 必须是非空列表」改为每次加载的描述中两者可以各自省略（只含块或只含服务的描述是正常的），但一次加载至少给出其中之一；`start()` 在没有任何服务时抛出。
- `load` 保持同步，只建服务不启动；运行中加载的新服务由再次调用 `start()` 启动，`start()` 只启动尚未运行的服务：es-modbus 的 `start()` 对已启动的服务是重启（先断开全部连接、关闭监听或串口，再重新打开），所以 emulator 要记下哪些服务已启动，不能对全部服务再调用一次。
- 诊断（串口总线上的广播与保留单元）在 `load` 中作为事件 `warning` 发出，此时调用方已能挂监听；`warnings` 数组随之删除。
- `stop()` 照旧交还所有已加载块的块名；块仍属于 emulator，再次 `load` 同名块仍按上面的块名规则报错。
- 同步修改 doc/spec.md、doc/design.md（含 zh-CN）、`src/index.d.ts`、README 与测试。

否决的方案：

- 只接受 `Description`（issue#xto6fnu4 为构造方法所定）：本包封装 layout-data 等包，既是最终程序，也是给下游的库。对最终使用者，配置文件是最自然的形式，理解 `Description` 有难度，所以 `load` 直接接受描述文件；`load` 收集 `desc_file` 的错误后，读取也纳入一次加载的全有或全无。同时保留 `Description`，使业务程序可以动态生成描述（如用 `JSON` 字符串编译）来调用本包。
- 保留 `constructor(descriptions, scope)` 并另加 `load`：同一件事有两种写法，构造时加载的那次仍不能先挂监听。
- 只把检查提前、保留构造时加载：登记域不再被失败改动，但检查仍在构造之中，诊断仍无法作为事件发出。
- 保持现状、失败后交还块名：失败的加载仍会把布局留在登记域中。
- 由 `Unit_Map` 另加一个只检查不挂接的方法：与 `attach_unit` 的重叠逻辑重复，临时表已能复用它。
- `load` 为异步、运行中自动启动新服务：加载与启动的失败混在一起，全有或全无无法覆盖启动；由调用方再调用 `start()` 更清楚。
- 不检查跨次加载的块名，由 layout-data 的检查兜底：它不覆盖不同布局上的同名块，`blocks` 会被静默覆盖。

## 裁定

接受。构造与加载分开后，调用方能在检查之前挂上监听，诊断才能作为事件发出；全部检查先于 `scope.load`，失败的加载不再改动登记域。es-modbus 的 `start()` 会重启已启动的服务，这已写进提案：`start()` 只启动尚未运行的服务。
