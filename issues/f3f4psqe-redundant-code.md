---
id: f3f4psqe
opened: 2026-10-17T23:58:30.000Z
closed: 2026-10-23T13:32:37.000Z
title: 冗余代码
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: [e7d125a]        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

- `#read_blocks` 的 `block_options` 参数无效（`new Ldata` 只接收两个参数），且调用处从未传入；
- `layouts_file` 的处理在 try 内 throw 再自行 catch，可直接 push 错误。

## 解决提案

删除无效参数 `block_options`；`layouts_file` 处直接 push 错误。

## 裁定

问题成立，按解决提案修复：两处都是无效或绕路的写法，删去后行为不变。
