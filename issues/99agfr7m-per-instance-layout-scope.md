---
id: 99agfr7m
opened: 2026-10-27T18:41:16.423Z
closed: 2026-10-27T22:01:36.000Z
title: 布局登记域绑定在整个包上，而不是各个模拟器实例上
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

位置：`src/emulator.js` 的模块级变量 `package_scope`、`time_scope_name` 和 `#load`；规范 §4“布局登记域”；设计中的“构造”“绑定”“登记域”三条（a60df57 引入，issue#xto6fnu4 升级 layout-data 0.6.0 时保留）。

现在第一个取得登记域的模拟器把整个包绑定到该登记域，直到进程结束：

- 之后的模拟器给出其他登记域名称，构造时报错 `scope X: the package uses scope Y`。
- 布局持有其 ldata 的名字（layout-data 的 issue#yxhoe1w3），而模拟器从不交还块名：同一份描述在同一进程中只能构造一次，不论构造成功还是失败，即使先前的模拟器已经 `stop()`。
- 省略登记域名称时，绑定之前用 UTC 时间构成名称，调用方事先不知道它。

设计意图应当为：一个模拟器实例只绑定一套布局；有多个实例时各用各的，互不串用。这样能简化布局的描述和实现模拟器实例之间的分离｡

影响：调用方无法在同一进程中多次用独立布局的描述构造模拟器。例如想模拟出多个布局有微小差异的多型号设备。

## 解决提案

方向：登记域的绑定归实例所有，去掉模块级的 `package_scope`；登记域由调用方在代码中选择（构造方法的参数 `scope`，issue#xto6fnu4 已用它取代描述的根键 `scope`）。实例之间的分离靠各自的 Ldata 块；布局的复用与冲突交给 layout-data 在一个登记域内按指纹判断，本包不另设表。

- 构造方法 `new Modbus_Emulator(descriptions, scope)` 的 `descriptions` 不变，仍是编译好的 `Description` 或其列表；`scope` 缺省改为 `modbus_emulator`，不再取已绑定的登记域或用时间构成名称；登记域为 `get_scope(scope) ?? create_scope(scope)`，描述由一次 `scope.load` 装入：布局名与结构都相同的布局复用，同名而结构不同、或结构相同而名称不同是错误。
- 布局持有其 ldata 的名字（layout-data 的 issue#yxhoe1w3）。`stop()` 用 `delete_ldata` 把块名交还给布局；构造在装入之后失败时也交还。因此同一份描述在先前的模拟器 `stop()` 后，可以在同一登记域中再次构造；需要同时运行时，各实例用不同的登记域名。
- 布局有微小差异的多型号设备：同名而结构不同的布局放进不同的登记域，由调用方给出不同的 `scope`；都用缺省登记域时报错，不会绑错。
- 调用方通过实例的 `scope`、`layouts` 属性取得它的登记域和布局；`layouts` 的键顺序无意义。

不采用的做法：

- 布局特征值（各描述 `layouts` 与 `item_tables` 合并后的哈希）加进程内的特征值表、无 `scope` 时以 `s` 加特征值前 8 位命名登记域：layout-data 的 issue#qpupna3c 让登记域只由代码决定，自动生成的名字调用方拿不到；布局的复用 layout-data 已按单个布局的指纹在登记域内完成，本包重复实现没有意义。
- 保留包级绑定，只交还块名：同一进程中仍不能用不同的登记域分开同名而结构不同的布局，多型号设备的问题不解决。
- 新增 `close()` 专门交还块名，`stop()` 只停止服务：`stop()` 已是模拟器结束服务的时机，交还块名后数据块仍可用，`start()` 可以再次服务它们，不需要另一个方法。

## 裁定

接受，按解决提案实施。包级绑定使同一份带布局的描述在一个进程中只能构造一次，与“一个实例绑定一套布局”的设计意图不符。原先按布局特征值自动选择登记域的方案，随 layout-data 改为由代码选择登记域（issue#qpupna3c）而取消：登记域由构造参数指定，缺省为 `modbus_emulator`，布局的复用由 layout-data 在登记域内完成，`stop()` 和装入之后的构造失败交还块名，使同一份描述可以再次构造。
