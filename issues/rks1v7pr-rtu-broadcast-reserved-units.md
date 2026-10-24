---
id: rks1v7pr
opened: 2026-10-17T23:58:13.000Z
closed:
title: RTU 的 unit 0 与保留地址未说明
status: open        # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

RTU 下 unit 0 是广播地址：es-modbus 对它只执行写、不应答。挂在 unit 0 的块对 RTU 主站不可读。248..255 在串行总线上是保留地址。spec 允许 `unit_id` 为 0..255，未说明这些语义，校验也不提示。

## 解决提案

在 spec 中说明，并在校验时给出警告（不作为错误）：RTU 服务所服务的单元含 0 或 248..255 时产生警告。

警告在构造期产生，调用方还来不及挂监听器，因此不用事件，收入模拟器的 `warnings` 属性（见 issue#mnwdf2fy）。

测试：RTU 服务的单元含 0 或 248..255 时产生警告，TCP 服务不产生。

放弃的方案：通过 logger 报告，logger 将被去掉（issue#mnwdf2fy）。

## 裁定
