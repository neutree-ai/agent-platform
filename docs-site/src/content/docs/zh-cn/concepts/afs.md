---
title: AFS：跨 Agent 文件共享
description: 一套带权限的共享文件系统，让 Workspace 之间能安全地交换文件
---

每个 Workspace 都有自己独立的文件系统——这是 Workspace 隔离性的基础，但也意味着 A 写下的文件 B 默认看不到。当多个 Agent 需要协作交付一份产物时（比如 planner 拆任务、worker 各做一段、最后归档），就需要一个可控的方式把文件在 Workspace 之间共享。

**AFS（Agent File System）** 是 Neutree Agent Platform 为此提供的能力：一套带权限的共享文件系统，对 Agent 来说就是容器里的一个目录，对用户来说是 **文件** app 里的「网盘」标签。

## 它解决什么问题

不用 AFS 时，跨 Workspace 传文件只能靠把内容塞进对话或者经第三方对象存储中转——前者把上下文撑爆，后者多一层凭据管理。AFS 把这一层做成基础设施：

- **以路径共享，不以内容共享**——Agent 把文件写到共享目录，对方直接在自己的容器里以同一个路径读到，不需要序列化、不需要传输
- **权限可控**——共享方决定谁能访问、是只读还是可写
- **撤回干净**——共享方解除分享后，所有挂载点立即失效

## 看得见的部分

### 用户视角：文件 app 的「网盘」标签

打开 Workspace 的 **文件** app，顶部有两个标签：

- **本地**——这个 Workspace 自己的文件系统
- **网盘**——当前 Workspace 能看到的所有共享目录

「网盘」根目录下每一项是一个**共享目录**：你创建的，或者别的 Workspace 分享给你的。你可以：

- **新建共享目录**——给它起个名字（小写字母、数字、连字符），它会同时挂载到你自己的 Workspace
- **管理成员**——把这个共享目录授权给你自己其他的 Workspace 访问，选只读或读写
- **解除分享**——取消某个成员的访问，或者把整个共享目录销毁

共享目录在所有挂载方那里都呈现为同一个路径 `/mnt/afs/<name>`——这是 AFS 的核心契约：**路径稳定**，跨 Workspace 不变。

### Agent 视角：平台 MCP 工具

Agent 不直接看 web 界面，它通过平台内置的 MCP 工具来管理共享。这些工具开箱即用，不需要单独配置：

- `share_folder(name)`——创建/确保一个共享目录，挂到自己 Workspace 的 `/mnt/afs/<name>`
- `grant_access(name, slug, readonly?)`——把这个共享目录授权给另一个 Workspace（用它的 slug 标识），目标 Workspace 立即看到同名路径
- `unshare_from_all(name)`——撤销目录的所有共享，并销毁底层存储

也就是说，Agent 可以在对话中自主完成"建共享 → 写文件 → 授权给协作方 → 调用对方"的整套流程，不需要人工介入。

## 一个典型流程：call_agent + AFS

一个常见的协作场景：parent agent 准备好一份资料，让 child agent 基于这份资料完成下一步。直接把内容粘进 prompt 会撑爆上下文，借 AFS 就很顺：

1. parent 调用 `share_folder("task-2026-05")`——拿到挂载点 `/mnt/afs/task-2026-05/`
2. parent 把要交接的文件写进这个目录（用平时用的文件工具，路径就是普通文件）
3. parent 调用 `grant_access("task-2026-05", "child-agent", readonly=true)`——child 的 Workspace 立即在同名路径下看到这些文件
4. parent 调用 child agent（参见 [多 Agent 协作](/guides/6-compose-agents/)），prompt 里只需引用路径：`"请处理 /mnt/afs/task-2026-05/ 下的文件"`
5. child 在自己的容器里直接读路径，完成任务，可以把产物写回（如果授权是 read_write）或写到自己 Workspace 的本地

## 工作原理（科普）

> 这一节是给好奇底层的同学准备的，不影响使用。

AFS 是一套独立的组件（Rust 实现），由两类进程组成：

- **afs-controller**——中心化的元数据 + 鉴权服务，gRPC 接口，元数据存在 SQLite。负责注册存储后端、创建/销毁共享目录、记录哪些主机挂载了哪些目录
- **afs-fuse**——每台 agent 主机上跑一份的 FUSE 守护进程，gRPC 接口。收到挂载指令后基于 [FUSE](https://www.kernel.org/doc/html/latest/filesystems/fuse.html) 在指定路径暴露共享目录，文件读写代理到对应的存储后端

**存储后端**目前支持两类：

- **local**——共享 controller 所在主机的本地目录（适合单机或共享卷）
- **nfs**——挂载一个 NFS export，让所有 agent 主机共享同一份数据

每个共享目录在创建时由 controller 分配一个不可变的 `access_key`，访问凭据和挂载时的只读/读写由 gRPC 调用强制——任何主机要挂载这个目录都必须出示正确的 key，撤销时 controller 通知所有挂载方的 afs-fuse 强制 unmount，业务容器里那个路径瞬间消失。

在 Neutree Agent Platform 里，这套组件的形态是：集群里跑一份 afs-controller，每个 Workspace pod 注入一个 afs-fuse sidecar；控制面把上面那一层"用户/Workspace/分享关系"的语义映射到 controller 的"目录/挂载/access_key"模型——所以用户和 Agent 看到的是「网盘」和 MCP 工具，不直接和 access_key、目录 ID 这些底层概念打交道。

对 Agent 和用户来说，这些都是透明的——看到的就是一个目录。

## 几条使用建议

**目录名要稳定**——Agent 之间约定的 slug + 目录名一旦写进 prompt 或 skill，改名会断引用。命名时想清楚。

**默认只读，需要协作回写再开 read_write**——只读分享不会有竞争写问题，更安全。需要 child agent 写回产物时再单独开权限。

**用完销毁**——一次性任务结束后，用 `unshare_from_all` 把共享目录回收，避免共享列表越积越长。长期协作的"团队网盘"性质的目录则可以保留。

**不要把 AFS 当对象存储用**——AFS 设计目标是 Agent 协作时的文件交接，不是大规模冷存储。文件量级和访问模式都按"工作目录"来理解。
