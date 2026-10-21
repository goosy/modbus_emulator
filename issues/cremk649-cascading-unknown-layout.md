---
id: cremk649
opened: 2026-10-17T23:58:12.000Z
closed:
title: 布局错误引发连带的 unknown layout 错误
status: open        # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

一个布局编译出错时，layout-data 整体不注册，于是每个块都追加一条 `unknown layout`，真正的错误被淹没在噪声中。

## 解决提案

布局注册失败时，不再对每个块追加连带的 `unknown layout` 错误。

## 裁定
