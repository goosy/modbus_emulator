---
id: kgdrwxq2
opened: 2026-10-24T15:01:24.251Z
closed: 2026-10-24T16:20:22.000Z
title: 部分描述错误不收入 errors，而是直接抛出
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: [a03e9cc]        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

位置：`src/emulator.js` 的 `#read_blocks`、`#read_servers`。

spec 约定：描述不合法时，构造函数抛出一个 `Error`，其 `errors` 属性列出全部违规项。以下两种错误没有被模拟器校验，而是由依赖（layout-data、es-modbus）抛出，绕过了这一约定：

- 块名不是字符串（如 `name: 123`）：模拟器不检查块名的类型，校验循环中的 `new Ldata(layout, name)` 抛出 layout-data 的 `TypeError`，校验中途中止。
- RTU 服务的串口参数不合法（如 `baud_rate: -1`、`data_bits: 9`）：`#read_servers` 只检查串口路径，`baud_rate`、`parity`、`data_bits`、`stop_bits` 不检查；全部校验通过后创建服务时，由 es-modbus 抛出。

影响：调用方收到的是没有 `errors` 属性的异常。块名错误还会丢掉此前已收集的违规项；串口参数错误只在没有其他违规项时才出现，不能与它们一起报出。

## 解决提案

在校验阶段补上这两项检查，违规时收入 `errors`：

- 块名：给出时须为非空字符串。
- 串口参数：取值范围与 es-modbus 一致：`baud_rate` 为正整数，`parity` 为 `none` / `odd` / `even`，`data_bits` 为 5、6、7、8，`stop_bits` 为 1、1.5、2。

测试：两种错误都出现在 `errors` 中，并与其他违规项一起报出。

## 裁定

问题成立，按解决提案修复：校验阶段检查块名须为非空字符串、RTU 串口参数取值与 es-modbus 一致，违规时收入 `errors`，与其他违规项一起报出。
