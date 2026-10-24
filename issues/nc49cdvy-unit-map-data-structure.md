---
id: nc49cdvy
opened: 2026-10-17T23:58:19.000Z
closed: 2026-10-24T12:53:23.000Z
title: Unit_Map 的数据结构
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: [94b5f08]        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

- 单元直接以数字下标挂在实例上（`unit_map[1]`），与 `unit_ids` 属性混在一起，类型声明只能写成索引签名。
- 段数组按挂载顺序排列，未排序，查找只能线性扫描。
- `unit_ids.includes` 是线性查找。
- 偶数 offset 的约束只在 `Modbus_Emulator` 中检查，手工装配 `Unit_Map` 的调用方得不到保护。

## 解决提案

- 内部改用私有的 `Map`，单元不再是实例属性；`unit_ids` 改为只读 getter。
- 提供 `segments(unit_id)`（按 `start` 排序的段）与 `resolve(unit_id, byte)`（二分查找，返回块与块内偏移，未映射为 null），handler 经 `resolve` 查找。
- `attach_unit` 负责 `start` / `offset` 的偶数校验，不合格抛出 `RangeError`；按 `start` 有序插入段。重叠检查见 issue#xrstt0sk。
- spec / design 写明服务的 `unit_ids` 与单元表的关系（见下）。

**放弃的方案**

`freeze()` 冻结单元表，禁止之后的 `attach_unit`。

否定理由：单元表是数据，服务应答哪些单元是服务的配置，两者无关，使用它反而会给其它实例制造麻烦。两者机制如下：

- 单元表是数据：某个单元的哪些字节挂着哪个块。`attach_unit` 只改变单元表。handler 每次请求都实时查单元表，所以挂上的块立即可读写。
- 服务应答哪些单元是服务的配置。工厂把 `unit_ids` 传给 es-modbus 的 `Modbus_Server` 构造函数，es-modbus 在构造时把它复制为服务自己的集合；省略 `unit_ids` 时，工厂取创建服务时单元表的 `unit_ids` 作为缺省值。
- 从创建起，服务的集合就与单元表相互独立：`attach_unit` 与它没有任何关系，之后挂上的单元不会加进已有服务的集合；要给服务增加或去掉单元，调用服务的 `set_unit_ids`。服务收到集合外的单元号时，由 es-modbus 应答异常码 0x0B。

## 裁定

问题成立，按解决提案修复：
- 单元表改用私有 `Map` 并提供 `segments` / `resolve`，`attach_unit` 负责偶数校验并有序插入；
- 将机制写入 spec / design：服务的 `unit_ids` 从创建起与单元表相互独立，增减单元用服务的 `set_unit_ids`，与 `attach_unit` 无关。
