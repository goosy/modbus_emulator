---
id: j43awjvg
opened: 2026-10-17T23:58:23.000Z
closed: 2026-10-24T18:29:00.000Z
title: 类型声明不完整
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

- `layouts`、`blocks` 应为只读，声明中可赋值；
- `Modbus_Server` 接口缺少实际在用的 `port`、`protocol`、`is_valid_unit_id`；

## 解决提案

- `Modbus_Emulator` 在构造时确定、不应重新赋值的属性都标 `readonly`：`unit_map`、`handler`、`layouts`、`blocks`、`servers`、`warnings`。容器的内容也只读：`blocks` 为 `ReadonlyMap`，`layouts` 为 `Readonly<Record>`，`servers`、`warnings` 为只读数组；只标 `readonly` 只能防止属性被整体替换。
- `Modbus_Server` 补上 `port`、`protocol`、`is_valid_unit_id`。

原先一并列出的过时注释（`Modbus_Server` 的注释写着 es-modbus “bundled into this package”）已单独修正，提交中引用了本 issue。

## 裁定

问题成立，按解决提案修复：`Modbus_Emulator` 构造时确定的属性及其内容声明为只读，`Modbus_Server` 补全实际在用的属性与方法。
