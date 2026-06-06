上传一个打包好的 skill 目录（`.tar.gz`）。

## 打包方式

<platform-cmd>
macos: |
  COPYFILE_DISABLE=1 tar --exclude='.DS_Store' --exclude='._*' \
    -czf skill.tar.gz -C /path/to/skill-dir .
linux: |
  tar -czf skill.tar.gz -C /path/to/skill-dir .
windows: |
  tar -czf skill.tar.gz -C C:\path\to\skill-dir .
</platform-cmd>

目录内需要包含 `SKILL.md` 文件作为 skill 的入口描述。

## 字段说明

- **Name** — Skill 的唯一标识名称
- **Description** — 简要描述 skill 的功能
- **Category** — 在资源库筛选 chips 中分组（可选）
- **Public** — 开启后平台所有用户可见可用，否则仅自己可见

## 目录结构示例

```
my-skill/
├── SKILL.md          # 必需，skill 描述和使用说明
├── prompt.md         # 可选，prompt 模板
└── resources/        # 可选，附带资源文件
```
