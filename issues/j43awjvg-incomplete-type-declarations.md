---
id: j43awjvg
opened: 2026-10-17T23:58:23.000Z
closed:
title: 类型声明不完整
status: open        # open | accepted | fixed | rejected | wontfix
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

`layouts`、`blocks` 标 `readonly`；`Modbus_Server` 补上 `port`、`protocol`、`is_valid_unit_id`。

原先一并列出的过时注释（`Modbus_Server` 的注释写着 es-modbus “bundled into this package”）已单独修正，提交中引用了本 issue。

## 裁定
