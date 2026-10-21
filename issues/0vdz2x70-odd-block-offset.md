---
id: 0vdz2x70
opened: 2026-10-17T23:58:07.000Z
closed:
title: 块的 offset 没有要求偶数
status: open        # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

位置：`src/emulator.js` 的 `#read_blocks`。

只检查了非负整数。奇数 `offset` 使块在单元中的有效长度为奇数，最后一个寄存器读到块外。

复现：`offset: 1` 时读最后一个寄存器，`read_bytes` 抛出 RangeError，主站收到异常码 0x04。

layout-data 已拒绝长度不是整寄存器的布局，所以问题只来自 `offset`。

## 解决提案

校验要求 `offset` 为非负偶数，同步 spec。

## 裁定
