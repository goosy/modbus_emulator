# modbus-emulator 描述规范

> 英文版：[spec-descriptions.md](spec-descriptions.md)，两者保持同步。
>
> 本文细化 [spec.zh-CN.md](spec.zh-CN.md) 第 5 节：`Modbus_Emulator` 的 `load` 所接受的描述。文中引用的 spec 章节是地址映射（spec 第 3 节）和接口（spec 第 4 节）。

描述是模拟器的配置，以数据而不是代码写出。它说明模拟哪些设备、主站如何访问它们：

- 每类设备的数据：它的布局，即各 tag 的名字、类型、位置和初始值，相当于设备的点表；
- 数据块：布局的实例，即一份具体的数据；一个设备的数据可以由一个或多个数据块组成；
- 单元：提供数据块的从站地址，各数据块位于单元的哪些寄存器和线圈，设备的字节序，以及哪些点只读；
- 服务：传输方式（Modbus TCP、UDP、RTU 及其变体）及其端口。

`load` 读取描述，据此建立数据块、单元和服务，所以搭建模拟器不必在代码里写地址映射：使用者编辑描述文件即可，程序也可以生成描述。之后调用方只需通过 Ldata / Ltag 操作数据块，模拟设备的行为。布局写一次，可供任意多个数据块使用；它的 tag 按设备数据的字段命名，所以模拟器、主站一侧和模拟设备行为的代码说的都是同一组 tag。

## 1. 形式与来源

本包的描述是 layout-data 的描述，外加本包的根键 `units` 和 `servers`。它写在 YAML 1.2 文件或文本中（JSON 也是 YAML 1.2），由本包转发的 `desc_file`（描述文件）或 `yaml`（YAML 文本）编译。第 2 节概述 layout-data 的部分，完整规则见 layout-data 的 [spec-description](https://github.com/goosy/layout-data/blob/main/doc/spec-description.zh-cn.md)。

描述含四部分：布局及其条目表、数据块、单元、服务（第 3 节）。

- 这四部分也可以分写在多个来源里（一次 `load` 的 `sources` 列表）：各来源的 `blocks`、`units` 和 `servers` 按列表顺序连接，全部描述一并装入登记域。有多个来源时，本包的出错信息以来源开头：描述文件用其路径，`Description` 用 `description #N`，与 layout-data 对列表项的称呼相同；
- `blocks`、`units` 和 `servers` 可以各自省略，但一次装入至少要给出数据块或服务之一；
- 条目接着先前装入的条目编号，所以 `blocks[i]`、`units[i]`、`servers[i]` 就是条目在模拟器中的位置；
- 描述是自足的：数据块引用的布局列在它自己的描述的 `layouts` 中，布局的条目表可以来自 `imports` 引入的文件；单元放置的是它自己的描述中的数据块。描述不指定登记域（spec 第 4 节）。

## 2. layout-data 的部分

layout-data 读取四个根键，其余的不读：

- `imports`：本描述要用其条目表的描述文件的路径列表。相对路径相对于描述文件所在目录；YAML 文本没有文件，其 `imports` 用绝对路径或 `file:` URL。被引入的描述只提供条目表，它的 `layouts` 和 `blocks` 被忽略。引入可以传递，但不得成环；
- `layouts`：布局名列表，每个名字是 JavaScript 标识符，不得重复。每个名字是一张条目表，编译成同名的布局；
- `item_tables`：条目表名到条目表的映射。条目表是条目的列表，可以由 `layouts` 列为布局，也可以被其他条目按名字引用，或两者兼有；
- `blocks`：数据块列表，layout-data 读取其条目的 `name`（数据块名，在描述内唯一）和 `layout`（同一描述的 `layouts` 列出的布局名）。数据块的 Ldata 在描述装入时、在它装入的登记域中创建。

条目分为 tag 条目和引用条目：

| 条目 | 字段 |
| --- | --- |
| tag 条目 | `name`、`type`、`offset` 必须写明；`length`、`init_value`、`comment`、`coupling`、`is_combined` 可选 |
| 引用条目 | `includes` 和 `offset` 必须写明；`name_prefix` 可选 |

- `name` 是 tag 名，为标识符，在布局内唯一；
- `type` 取 `Bool`、`Byte`、`SInt`、`USInt`、`Int`、`UInt`、`Word`、`DInt`、`UDInt`、`DWord`、`Real` 之一，不区分大小写；
- `offset` 是位偏移。Bool 以外的 tag 从整字节开始，多字节的 tag 从偶数字节开始。`length` 以位计，写明时须与类型一致；
- `init_value` 是初始值，须能由该类型表示；不写时 tag 初始为 0（Bool 为 `false`）；
- `coupling` 构成组合字：一个字，它的位是一张条目表（具名或内联）中的 Bool 条目，偏移相对于该字；字和它的位共用数据。初始值只能由其中一方给出；
- `includes` 把一张条目表（具名或内联）的条目整体平移 `offset` 后拼入，名字加上 `name_prefix` 前缀。

从 `layouts` 出发，经 `includes` 和 `coupling` 到达的条目表在本描述及其引入的描述中按名字查找，每张都必须恰好在其中一份里定义；没有到达的条目表不读。一个布局中，Bool 以外的 tag 的字节区间不得重叠，每一位至多属于一个 Bool，落在其他 tag 之内的 Bool 必须是该组合字的位，总长度是整数个寄存器（16 位的倍数）。

`desc_file` 和 `yaml` 在编译描述时完成全部这些检查，出错时抛出 `Error`，其 `errors` 属性列出所有违规。编译结果 `Description` 含编译好的布局，其余根键（包括 `units` 和 `servers`）保持原样，本包从中读取它们。

## 3. 示例

```yaml
# 1. layouts and item tables, in the format of layout-data
layouts: [PUMP]
item_tables:
  PUMP:
    - { name: id, type: UInt, offset: 0, init_value: 7 }
    - { name: pressure, type: Real, offset: 16, init_value: 1.5 }

# 2. the blocks, in the format of layout-data
blocks:
  - { name: pump_1, layout: PUMP }
  - { name: pump_2, layout: PUMP }
  - { name: pump_3, layout: PUMP }

# 3. the units: the byte order of the device and the placement of its blocks
units:
  - unit_id: 1                     # 0..255
    endian: LE                     # BE (default), LE, BEBS or LEBS
    unmapped_read: zero            # zero (default) | refuse
    unmapped_write: ignore         # ignore (default) | refuse
    blocks:
      pump_1: {}
      pump_2: { start: 400, readonly: [pressure] }  # start: byte offset in the unit, even; readonly: none (default) | all | tag names
  - unit_id: 3
    blocks:
      pump_3: { offset: 2 }        # offset: start byte inside the block, even

# 4. the services
servers:
  - { protocol: tcp, host: 0.0.0.0, port: 502 }
  - { protocol: rtu_over_tcp, port: 503 }
  - { protocol: udp, port: 502 }
  - { protocol: rtu, port: COM3, baud_rate: 9600, parity: none }
```

## 4. 数据块

- 数据块条目只定义数据块，没有本包的键：数据块在哪里对外提供、提供它的设备有什么属性，都写在单元条目里；
- `blocks[].name` 必须写明，是其布局的其他数据块、模拟器的其他数据块都未用过的字符串（layout-data 与本包）；`blocks[].layout` 是同一描述中的布局名；
- 数据块条目只有 `name` 和 `layout` 两个键，其他键是错误。

## 5. 单元

- `units[].unit_id` 必须写明，取值 0..255 的整数，不得与本次装入的其他单元条目或先前装入的单元重复：单元只在一次装入中声明，装入后不再改变；
- `units[].endian`（可选）是单元的字节序，取 `BE`、`LE`、`BEBS` 或 `LEBS`，缺省 `BE`（spec 第 3 节）；
- `units[].unmapped_read`（可选）取 `zero`（缺省）或 `refuse`，`units[].unmapped_write`（可选）取 `ignore`（缺省）或 `refuse`：单元如何应答对其未映射地址的读和写（spec 第 3 节）；
- `units[].blocks` 必须写明，是非空对象，键是数据块名，值是该数据块的放置。放置有可选的 `start`（数据块在单元内的起始字节）和 `offset`（数据块从自身的第几个字节起对外提供），都是偶数非负整数，缺省为 0，`offset` 须小于数据块大小，使放置至少提供一个寄存器；`{}` 表示把整个数据块放在单元的字节 0 处。同一单元内各数据块的字节区间不得重叠；
- 放置可以有 `readonly`（spec 第 3 节）：`none`（缺省）；`all`，整块只读，包括填充位；或该数据块布局中的 tag 名组成的非空列表，列出的 tag 只读。布局中没有的名字、重复的名字是错误；同时列出组合字和它的耦合位是允许的。只读 tag 落在放置没有提供的部分（`offset` 之前）时没有效果；
  - 只读的点按 tag 声明，不按字节或寄存器区间：写描述的人以 tag 思考，区间要对照布局换算，布局一改就要跟着改；
- 描述中的每个数据块都必须由本描述的单元条目放置，且只能放置一次：没有被放置、被放置两次，或由其他描述的单元条目放置，都是错误；
- 单元条目只有 `unit_id`、`endian`、`unmapped_read`、`unmapped_write`、`blocks`，放置只有 `start`、`offset` 和 `readonly`；其他键是错误。

## 6. 服务

- `servers[].protocol` 取 `tcp`、`rtu_over_tcp`、`udp`、`rtu_over_udp`、`rtu`；
- `tcp`、`rtu_over_tcp`、`udp` 和 `rtu_over_udp` 的 `host` 缺省 `0.0.0.0`、`port` 缺省 502，`port` 为 1..65535 的整数（es-modbus 不接受端口 0）；
- `rtu` 的 `port` 为串口路径，可带 `baud_rate`（正整数，缺省 9600）、`parity`（`none`、`odd` 或 `even`，缺省 `none`）、`data_bits`（5、6、7 或 8，缺省 8）、`stop_bits`（1、1.5 或 2，缺省 1）；
- 两个 `tcp` / `rtu_over_tcp` 服务不得使用相同的 `host` 和 `port`，两个 `udp` / `rtu_over_udp` 服务也不得如此，不同 `host` 可用同一端口；TCP 与 UDP 的端口相互独立，一个 `tcp` 或 `rtu_over_tcp` 服务与一个 `udp` 或 `rtu_over_udp` 服务可以使用相同的 `host` 和 `port`；两个 `rtu` 服务不得使用同一串口路径；
- `servers[].unit_ids`（可选）：该服务应答的单元号，非空整数列表，取值 0..255，且每个单元号在装入后必须是模拟器的单元；缺省应答全部单元，包括之后装入的单元；
- 所有服务共用同一个单元表和同一组数据块，`unit_ids` 只决定各服务应答哪些单元；
- 服务条目只有 `protocol`、`unit_ids`，以及 `tcp` / `rtu_over_tcp` / `udp` / `rtu_over_udp` 的 `host`、`port` 或 `rtu` 的 `port`、`baud_rate`、`parity`、`data_bits`、`stop_bits`；其他键是错误。

## 7. 根键与布局文件

- 根键不检查：`imports`、`layouts`、`item_tables`、`blocks`、`units`、`servers` 以外的键不被使用，可以存放调用方需要的任何内容；
- 条目表可以不写在描述里：描述用 `imports` 引入它们，并在 `layouts` 中列出自己的布局；布局文件也与其他来源一样是 `sources` 列表的一项：全部来源一并装入，列出同名且结构相同布局的描述共用该布局。
