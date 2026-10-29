---
id: xto6fnu4
opened: 2026-10-29T12:28:54.912Z
closed: 2026-10-29T12:58:36.000Z
title: 升级依赖 layout-data 0.6.0 并适配，构造方法接受编译好的描述
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: [6f758ae]        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

位置：`package.json` 的依赖 `layout-data: 0.5.0`；`src/emulator.js` 的构造方法与 `#get_scope`、`#read_blocks`；`src/index.js`、`src/index.d.ts` 的转发；规范 §2、§4“布局登记域”、§5；设计中的“构造”“登记域”两条；README。

layout-data 0.6.0 改变了本包所用的接口：

- `register_layout` 和 `yaml_file` 不再存在。描述由 `yaml`（YAML 文本）或 `desc_file`（描述文件，连同其 `imports`）编译成 `Description`；登记域的 `load(descriptions)` 接受一个 `Description` 或其列表，注册其布局（指纹与名称都相同的布局复用），并建立其 `blocks` 的 ldata，全部或全部不，返回 `Registration`（`layouts`、`ldata`）。它不读文件，也不接受普通对象。
- 描述不指定登记域（layout-data 的 issue#qpupna3c）：登记域只在代码中选择。
- 数据块条目必须给出 `name` 和 `layout`，`layout` 是本描述列出的布局；数据块由 `load` 建立，不再能引用登记域中已注册、而本描述未列出的布局。
- 布局持有其 ldata 的名字（layout-data 的 issue#yxhoe1w3）：同一布局的同一 ldata 名不能再建立，直到 `delete_ldata`。

本包停留在 0.5.0，无法使用这些接口。现在的构造方法接受描述文件路径，以及给控制器用的、不公开的同结构对象（issue#g57sjq24 裁定其为有意的内部入口）。0.6.0 的 `load` 只接受 `Description`，这个对象入口无法沿用；下游需要一个能直接传入描述的、稳定的入口，避免在接口变化期间无法工作。

## 解决提案

本 issue 只做升级 0.6.0 所必需的适配，不包含 issue#99agfr7m 的修复部分（去掉包级绑定、`stop()` 交还块名、缺省登记域 `modbus_emulator`）：

- 依赖升级为 `layout-data: 0.6.0`。
- 构造方法改为 `new Modbus_Emulator(descriptions, scope)`：`descriptions` 是一个 `Description` 或其列表，与登记域 `load` 的第一个参数相同，原样传给它；本包不再读取描述文件，路径和普通对象都不再接受。调用方用本包转发的 `desc_file` 或 `yaml` 编译描述，例如 `new Modbus_Emulator(desc_file\`plant.yaml\`, "plant")`；读取、解析和描述本身的错误由它们产生，已指明来源，本包不对来源另做处理。`blocks` 和 `servers` 按列表顺序连接；有多个描述时，本包自己的检查（`unit_id`、`start`、`offset`、`servers`）的出错信息以 `description #N: ` 指明所在描述，与 layout-data 对列表项的称呼相同。
- 原先不公开的描述对象入口（issue#g57sjq24）随之作废：`Description` 是公开的描述类型。原先传描述对象的调用，把对象转成 JSON 文本交给 `yaml`（JSON 是 YAML 1.2 的子集）即得等价的 `Description`：`new Modbus_Emulator(yaml(JSON.stringify(object)), scope)`。YAML 文本没有所在文件，其 `imports` 中的相对路径无法解析，要写绝对路径或 `file:` URL。
- `scope` 取代描述的根键 `scope`，其余规则不变：本包每进程一个登记域，第一个取得登记域的模拟器把本包绑定到它，之后给出其他名称是错误；省略时取已绑定的登记域，尚未绑定时用 UTC 时间构成名称。名称不是标识符时收集 `create_scope` 的错误。描述中的 `scope` 根键不再读取。
- 布局与数据块：编译后的描述交给一次 `scope.load`，其错误被收集；`layouts` 取 `Registration.layouts`，`blocks` 取 `Registration.ldata`，按条目顺序挂到单元表。本包只检查属于自己的条目键（`unit_id`、`start`、`offset`）以及 `servers`；`name`、`layout` 由 layout-data 检查。本包自己的检查放在 `load` 之前，检查失败时什么都不装入。`name` 必须写明，缺省名 `unit_<unit_id>` 取消；不带布局、只引用登记域中已有布局的描述不再可行。
- `load` 之后的失败（单元内数据块重叠、`unit_ids` 中没有数据块的单元）不交还块名：与现在“带布局的描述每进程只能构造一次，出错改正后重启进程”一致，约束的对象从布局注册变为布局持有的块名。
- 转发的接口：`yaml_file` 换成 `desc_file`；类型 `Layout_Item`、`Tag_Item`、`Include_Item`、`Layout_Description`、`Registered_Layouts` 换成 0.6.0 的 `Layout_Desc`、`Block_Desc`、`Description`、`Registration`。
- 文档：规范（含中文版）§2 的构造方法与转发接口、§4 的登记域、§5 的文件格式（改为 layout-data 的描述格式加本包的根键 `servers`，不再有 `scope`）；设计（含中文版）的“构造”“登记域”；README 的示例与说明；`src/index.d.ts`。`example/emulator.yaml` 按新格式改写。
- 测试：按新的构造参数改写现有测试；`Description` 列表的连接与出错前缀；描述中缺少 `name` 的数据块；`load` 的错误被收集；对象经 `yaml(JSON.stringify(...))` 的等价调用；检查失败时登记域中没有新增布局和块名。

不采用的做法：

- 构造方法同时接受路径和 `Description`：入口会再次分成公开与不公开两种，读取文件也与 layout-data“`load` 不读文件”的分工重复；`desc_file` 已经把读取、编译和出错信息做完。
- 在本 issue 中一并实施 issue#99agfr7m 的修复：dev 上的修复与功能将在本 issue 的结果上重放，混在一起会使重放冲突。

## 裁定

接受，按解决提案实施。layout-data 0.6.0 的 `load` 只接受编译好的 `Description`，构造方法直接接受它，使下游从描述对象平滑地转到 `Description`，不留无法工作的空档；只做升级所必需的适配，issue#99agfr7m 的修复在其后另行实施。
