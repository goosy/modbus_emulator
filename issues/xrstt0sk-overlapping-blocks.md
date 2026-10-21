---
id: xrstt0sk
opened: 2026-10-17T23:58:08.000Z
closed:
title: 同一单元内块的地址范围重叠没有检测
status: open        # open | accepted | fixed | rejected | wontfix
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

检测同一单元内块的字节范围重叠并报错。检查宜放在 `attach_unit` 中，使手工装配 `Unit_Map` 的调用方同样受保护（见 issue#nc49cdvy）。

## 裁定
