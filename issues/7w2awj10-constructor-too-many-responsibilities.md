---
id: 7w2awj10
opened: 2026-10-17T23:58:17.000Z
closed:
title: 构造函数职责过多
status: open        # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

`Modbus_Emulator` 的构造函数依次读文件、解析、校验、注册全局布局（有进程级副作用）、建块、建服务。有副作用的步骤夹在校验中间，校验也无法单独使用（如编辑器中预检描述文件）。

由此产生的缺陷：布局在 blocks 和 servers 校验之前就注册到 layout-data 的全局表中，之后的校验一旦失败，构造失败，但注册已经发生，而 `register_layout` 每进程只能成功一次。复现：描述因 `unit_id: 300` 失败；修正后在同一进程再次构造，报 `register_layout can be called only once`。热重载、GUI 等场景下无法重试。

## 解决提案

拆分为“加载与校验（纯函数）→ 构建（注册布局、建块）→ 建服务”三个阶段。所有校验完成之后才调用 `register_layout`，校验失败不再用掉注册的机会。

## 裁定
