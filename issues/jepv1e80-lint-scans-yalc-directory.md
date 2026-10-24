---
id: jepv1e80
opened: 2026-10-24T05:16:05.219Z
closed: 2026-10-24T05:46:53.000Z
title: 联调方式：design 推荐会产生两个模块实例的 pnpm link:，且 lint 扫描 .yalc 目录
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

位置：design（含中文版）关于联调的说明；`eslint.config.js`。

design 写的是"本地联调时可临时用 pnpm `link:` 链接 layout-data，提交或发布前改回版本号"。这个方法不应推荐：
- `link:` 让依赖指向它自己的仓库目录，按那个目录解析模块，于是调用方对本包所依赖的同一个模块会出现两个模块实例。
- 对 layout-data 而言，两个实例意味着两张布局登记表、两个 `Ldata` 类：`register_layout` 每进程只能成功一次的约定失效，调用方的 `instanceof Ldata` 对本包创建的块不成立。
- 这条说明也只提到 layout-data，没有涵盖 es-modbus。

## 解决提案

联调只用 yalc。yalc 把依赖的发布内容复制到 `.yalc/`，按普通依赖安装，模块解析与使用已发布的版本相同，不会产生第二个实例。

- design 中联调的说明改为：联调未发布的依赖（layout-data、es-modbus 等）时，只用 yalc 临时以 `file:.yalc/<name>` 引用；
- 提交或发布前改回已发布的版本号。删去 pnpm `link:` 的说法。
- `.gitignore` 加入 `.yalc/` 与 `yalc.lock`。
- `eslint.config.js` 的忽略列表加入 `.yalc/`。

## 裁定

问题成立，已修复：联调只用 yalc，design 删去 pnpm `link:` 的说法；eslint 忽略 `.yalc/`。
