# 后台订单提醒卸载夹具修复

原后台 related runner 已结束：102 个文件，101 个通过、1 个失败；866 项测试，865 项通过、1 项失败。唯一失败为 OrderNotifications.spec.tsx 的卸载清理夹具，原日志位于 ../admin-frontend-final-tests.log。

原因：原夹具先结束读取，再要求卸载使已经完成的请求 signal 变为 aborted。现有离线机制对每次读取使用独立 AbortController，读取结束后解绑 session 取消监听；此时卸载应清理 session 的重连等待，而不是修改已结束请求的 signal。

只修改测试文件，将两种状态分别验证，未修改运行时代码：

- 活动读取卸载：保留 signal.aborted === true，另验证 reader.cancel 已执行；推进 60 秒后没有重连或资源失效事件。
- 读取结束后的卸载：先验证重连计时数量增加 1，再验证卸载回到初始数量；推进 60 秒后没有新增读取或资源失效事件。

整个测试文件复测 33 / 33 通过（原 32 项加 1 项），日志为 admin-notifications-targeted.log。该文件 owned oxlint exit 0。运行时和构建输入未变化，已成功的最终后台构建与其他 101 个测试文件证据可复用，无需重复大 related suite 或构建。
