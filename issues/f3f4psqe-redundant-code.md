---
id: f3f4psqe
opened: 2026-10-17T23:58:30.000Z
closed:
title: 冗余代码
status: open        # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
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
