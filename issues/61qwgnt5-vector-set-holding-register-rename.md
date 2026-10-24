---
id: 61qwgnt5
opened: 2026-10-24T05:16:05.092Z
closed: 2026-10-24T07:17:14.000Z
title: es-modbus 的 vector 改名为 handler，写寄存器全部失败，handler 错误不再记录
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

位置：`src/unit_map.js` 的 `create_vector`；`src/index.d.ts` 的 `Modbus_Vector`；`src/server.js` 的 `log_events`；design（含中文版）对 vector 方法名和 `vector_error` 事件的说明。

es-modbus 0.3.0-beta.4 有两处与本包有关的改名，都不保留旧名：

- 写寄存器的方法 `set_register` 改名为 `set_holding_register`，批量方法相应为 `set_holding_registers`（es-modbus 的 `68a16aa`，es-modbus#yjaww5qx）。本包的 vector 仍提供 `set_register`。
- `Modbus_Server` 的 `vector` 改称 `handler`：属性 `vector` 改为 `handler`，事件 `vector_error` 改为 `handler_error`（es-modbus 的 `36ac96a`，es-modbus#fnhetwc4）。构造函数仍以第一个参数接收它，所以这处改名不强制本包自己的 vector 命名（`create_vector`、`options.vector` 等）随之改变；但 `log_events` 仍监听 `vector_error`。

现象：用 yalc 引用 es-modbus 0.3.0-beta.4（及尚未发布的 layout-data）运行现有代码：

- FC6 / FC16 写寄存器时 es-modbus 找不到方法，`handler_error` 为 `TypeError: this.handler[name] is not a function`，主站收到异常 0x04，写入没有发生。读请求和线圈写不受影响。测试 41 项中 7 项失败，都是写寄存器的用例。
- handler 抛出异常时，主站照常收到 0x04，但这个错误不再写入日志，因为 `handler_error` 没有监听者。现有测试不覆盖这条日志，所以测试看不出这个问题；用一个会抛出异常的 vector 发起 FC3 请求即可复现：监听 `vector_error` 时日志为空，监听 `handler_error` 时日志收到 `server request failed: <message>`。

在副本中把 vector 的方法改名为 `set_holding_register`、把监听的事件改为 `handler_error` 后，41 项全部通过，handler 的错误也写入日志；所以对新版依赖而言，这两处是现有代码仅有的运行问题。其余变化不影响现有代码：FC2 在 vector 没有离散输入方法时回退到 `get_coil`，与原来相同；layout-data 把 `access` 纳入 `transaction` 对本包暂无影响，因为本包尚未使用 `transaction`；es-modbus 新增的寄存器值检查不会被本包返回的值触发。

## 解决提案

跟随 es-modbus 的改名：vector 的方法改名为 `set_holding_register`，`log_events` 监听的事件改为 `handler_error`。同时本包可以接受破坏性改动，所以本包中所有 vector 相关的命名也一律改称 handler，与 es-modbus 的术语一致，免得调用方在两个包之间对照两套叫法：

- 公开接口：`create_vector` → `create_handler`；类型 `Modbus_Vector` → `Modbus_Handler`；`Modbus_Emulator` 的属性 `vector` → `handler`；`create_tcp_server` / `create_rtu_server` 的选项 `vector` → `handler`。
- 内部标识符、注释和 JSDoc（如 `src/unit_map.js` 的局部变量 `vector`、`src/server.js` 的 `_vector`）。
- 测试中的调用、断言和用例名（如 “all the servers share one vector ...”）。
- 文档：spec、design（均含中文版）和 README 中 vector 的说法、方法名、`vector_error` 事件，以及 design 的章节标题 “Unit_Map and the Vector”。

与依赖升级放在同一个提交：依赖锁定为包含这两处改名的 es-modbus 精确版本 `0.3.0-beta.4`（发布之前用 yalc 引用，提交前须改回版本号）。

依赖锁定为精确版本，同时解决 issue#t15w08bd，不再等到版本提交时处理。

本包可以接受破坏性改动，不需要别名来保持兼容性。

## 裁定

问题成立，已修复：本包随 es-modbus 0.3.0-beta.4 改用 `set_holding_register` 和 `handler_error`，并把本包所有 vector 相关的命名改称 handler，与 es-modbus 的术语一致；依赖锁定为精确版本 `0.3.0-beta.4`。
