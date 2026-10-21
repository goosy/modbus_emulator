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

`Modbus_Emulator` 的构造函数依次读文件、解析、校验、注册全局布局（有进程级副作用）、建块、建服务。有副作用的步骤夹在校验中间，是 issue#a9rjgz00 的根源；校验也无法单独使用（如编辑器中预检描述文件）。

## 解决提案

拆分为“加载与校验（纯函数）→ 构建（注册布局、建块）→ 建服务”三个阶段。

## 裁定
