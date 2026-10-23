---
id: nph2fayr
opened: 2026-10-17T23:58:09.000Z
closed: 2026-10-23T14:07:46.000Z
title: 描述文件中的未知键被静默忽略
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

描述文件中拼错的键（如把 `start` 写成 `sart`、`unit_id` 写成 `unitid`）不报错，块按默认值挂载（例如挂在偏移 0）。

## 解决提案

数据块条目与服务条目中的未知键作为错误收入 `errors`。服务条目按协议检查：`tcp` / `rtu_over_tcp` 不接受串口参数，`rtu` 不接受 `host`。

根键不检查：`blocks`、`servers`、`layouts_file` 以外的根键是 layout-data 的片段名，拼错的根键无法与片段区分。

## 裁定

问题成立，按解决提案修复：数据块条目与服务条目的未知键收入 `errors`，服务条目按协议检查；根键不检查。
