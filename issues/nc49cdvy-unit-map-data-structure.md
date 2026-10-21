---
id: nc49cdvy
opened: 2026-10-17T23:58:19.000Z
closed:
title: Unit_Map 的数据结构
status: open        # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

单元直接以数字下标挂在实例上（`unit_map[1]`），与 `unit_ids` 属性混在一起，类型声明只能写成索引签名；`unit_ids.includes` 是线性查找。偶数与重叠等约束只在 `Modbus_Emulator` 中检查（且不完整），手工装配 `Unit_Map` 的调用方得不到保护。构建完成后仍可继续 `attach_unit`，而 es-modbus 在构造时就复制了 unit_id 列表，此后新增的单元不会生效。

## 解决提案

内部改用 `Map`，提供 `segments(unit_id)` / `resolve(unit_id, byte)`；`attach_unit` 负责偶数与重叠校验（见 issue#0vdz2x70、issue#xrstt0sk）；增加 `freeze()`。

## 裁定
