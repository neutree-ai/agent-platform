## Compute Resources

配置 workspace session 的计算资源限额。可选择预设规格或自定义各项数值。

### 注意事项

- Request 为保证分配量，Limit 为上限，需满足 Request ≤ Limit
- 集群资源不足时 session 会排队等待调度
- 存储在 session 之间持久化，不会因 session 结束而清除
