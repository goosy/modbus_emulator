---
id: zg54q38b
opened: 2026-10-17T23:58:24.000Z
closed:
title: logger 被包装两次
status: open        # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

`Modbus_Emulator` 已经调用 `normalize_logger`，传给 server 工厂后又包装一次。无害，但多余。

## 解决提案

不单独修改。issue#mnwdf2fy 去掉 `logger` 与 `normalize_logger`，本问题随之消失；在其修复提交中一并引用本 issue。

放弃的方案：只去掉一侧的包装。`create_tcp_server` / `create_rtu_server` 是公开函数，直接调用者依赖工厂内的包装，而模拟器侧的包装又用于 vector，且整套 logger 即将去掉，单独修改没有意义。

## 裁定
