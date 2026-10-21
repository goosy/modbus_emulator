---
id: cxh7ygz3
opened: 2026-10-17T23:58:20.000Z
closed:
title: 每进程只能有一个模拟器
status: open        # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

`register_layout` 每进程只能成功一次，带布局的 `Modbus_Emulator` 因此每进程只能有一个。这是 layout-data 带来的约束，spec 未明确写出。

## 解决提案

在 spec 中写明此约束；考虑请 layout-data 提供只校验不注册的 dry-run 或增量注册。

## 裁定
