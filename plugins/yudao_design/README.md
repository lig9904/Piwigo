# 渔岛设计资料插件

基于 Piwigo 16.4.0 稳定版，保留原有相册、用户、语言和插件功能。
新增独立项目库，一个版本可一次上传现场照片、效果图、GLB、PDF、DWG/DXF。
图片分组查看，GLB 可旋转缩放，PDF 同页查看，CAD 原文件下载。

## 启用与使用

1. 将 `yudao_design` 放在 Piwigo 的 `plugins/`，在插件管理中安装并启用。
2. 配置独立持久资料目录 `YUDAO_STORAGE_ROOT`，目录须在网站根目录之外且 PHP 用户可写。
3. 后台 `admin.php?page=plugin-yudao_design` 管理上传；公共入口 `plugins/yudao_design/project.php`。
4. 管理员上传，公开访客免登录读取。遵循 Piwigo 的 `guest_access` 与维护锁设置。
5. 已发布版本不覆盖；新方案添加新版本。同版本重试返回“已存在”，不会追加重复附件。

## 统一接口

所有方法通过 Piwigo `ws.php?format=json`，使用原有 JSON `stat/result/message` 响应。

- `GET method=yudaoDesign.projects.list`：项目与已发布版本，实际服务器上传限制。
- `GET method=yudaoDesign.projects.get&project_id=...`：单项目详情。
- `POST ?method=yudaoDesign.projects.import`：multipart `files[]`，字段 `title/region/version/description/project_id/manifest/pwg_token`。
- `project_id` 为空创建新项目，否则向该项目新增版本。
- `manifest` 是 `[{"name":"现场.jpg","role":"source"}]`；角色为 source/effect/document，建议列全本次附件。
- 先用原生 `pwg.session.login` 登录，再用 `pwg.session.getStatus` 获取 token，网页和批量脚本使用相同入口。
- 附件通过 `file.php?version_id=...&asset_id=...` 读取；支持 HEAD、Range 和下载文件名。

## 数据与格式

项目和版本放在两张插件自己的 InnoDB 表中，未修改 Piwigo 核心表结构。
文件先暂存、校验、写清单，再一起发布；失败不留下可浏览的半套项目。
资料保留原文件字节与 SHA256。停用或卸载插件均保留业务资料，避免误删。

支持 JPG/JPEG、PNG、WebP、GLB 2.0、PDF、DWG、DXF，以及 UTF-8 CSV/TXT（最多 16 MB）。表格与文字说明保留原件供下载。
GLB 需要把贴图内嵌，首版以常规未压缩 GLB 为验收范围。
DWG/DXF 原文件下载；浏览器中看 CAD 请同时上传对应 PDF。
本模块不直接执行上传的 HTML，也不转换 SKP/BLEND 或重建原有模型交互脚本。

上传上限由 PHP 和插件共同决定：最多 64 文件、512MB 单文件、1GB 总量；服务器更低时以实际配置为准。
依赖 `@google/model-viewer 4.4.0` 随插件部署，许可证见 vendor/。

批量导入工具：`tools/yudao/import_project.py`；密码通过环境变量或交互输入，不放在命令参数。
Docker 部署见 `deploy/yudao/README.md`。

## 已完成的本机验收

PHP 8.3 / MariaDB 11.4 隔离实例：真实混合 9 附件、两版保留及最新版本排序、中文与 emoji、重复版本 409；访客上传与无效 token/GLB 正确拒绝。两版 18 个原文件下载 SHA256 一致，GLB/PDF Range 返回 206 且字节一致。

浏览器实际验证模型加载、拖动旋转、滚轮缩放、PDF 三页渲染、后台表单保存与刷新、390px 手机布局。更新镜像并重启数据库与网站后，再次核对 18 个附件和匿名页面。上述为本机验证，NAS 实际部署应另行核对运行路径和访问结果。
