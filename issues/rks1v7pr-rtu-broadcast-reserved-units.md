---
id: rks1v7pr
opened: 2026-10-17T23:58:13.000Z
closed: 2026-10-24T18:27:41.000Z
title: RTU 的 unit 0 与保留地址未说明
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: [03d30e7]        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

RTU 下 unit 0 是广播地址：es-modbus 对它只执行写、不应答。挂在 unit 0 的块对 RTU 主站不可读。248..255 在串行总线上是保留地址。spec 允许 `unit_id` 为 0..255，未说明这些语义，校验也不提示。

## 解决提案

在 spec 中说明，并在校验时给出警告（不作为错误）：串行总线上的服务（`rtu` 与 `rtu_over_tcp`，即 es-modbus 中协议不是 `tcp` 的服务，它们都把 unit 0 当作广播）所应答的单元含 0 或 248..255 时产生警告。

警告在构造期产生，调用方还来不及挂监听器，因此不用事件，收入模拟器的 `warnings` 属性（见 issue#mnwdf2fy）。

测试：`rtu` 与 `rtu_over_tcp` 服务的单元含 0 或 248..255 时产生警告，`tcp` 服务不产生。

放弃的方案：通过 logger 报告，logger 将被去掉（issue#mnwdf2fy）。

## 裁定

问题成立，按解决提案修复：spec 写明串行总线上 unit 0 为广播、248..255 为保留地址；协议不是 `tcp` 的服务应答这些单元时，在 `warnings` 中给出警告。
