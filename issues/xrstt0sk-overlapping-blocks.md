---
id: xrstt0sk
opened: 2026-10-17T23:58:08.000Z
closed: 2026-10-24T12:55:35.000Z
title: 同一单元内块的地址范围重叠没有检测
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

位置：`src/unit_map.js` 的 `attach_unit`。

重叠的块照样构造成功，读写命中先挂载的块，后挂载的块在重叠部分不可达，没有任何提示。

## 解决提案

检测同一单元内块的字节范围重叠并报错。检查放在 `attach_unit` 中，使手工装配 `Unit_Map` 的调用方同样受保护。

测试：同一单元内块重叠时报错，经描述文件构造与手工装配 `Unit_Map` 两条路径都要覆盖。

## 裁定

问题成立，按解决提案修复：`attach_unit` 在有序插入前检查新段与相邻段是否重叠，重叠时抛出指明两个数据块的 `Error`，单元表保持不变；模拟器构造时把它作为该数据块条目的错误一并报告。
