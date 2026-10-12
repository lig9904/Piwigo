# 渔岛设计资料插件

基于 Piwigo 16.4.0 稳定版，保留原有相册、用户、语言和插件功能。
新增独立项目库，一个版本可一次上传现场照片、效果图、GLB、PDF、DWG/DXF。
图片分组查看，GLB 可旋转缩放，PDF 同页查看，CAD 原文件下载。

## 启用与使用

1. 将 `yudao_design` 放在 Piwigo 的 `plugins/`，在插件管理中安装并启用。
2. 配置独立持久资料目录 `YUDAO_STORAGE_ROOT`，目录须在网站根目录之外且 PHP 用户可写。
3. 后台 `admin.php?page=plugin-yudao_design` 管理上传；公共入口 `plugins/yudao_design/project.php`。
4. 管理员上传及管理项目权限。默认公开、访客免登录；可在项目的“项目访问权限”选择“需登录”并保存，所有已登录账号可查看，普通账号不能上传或修改。遵循 Piwigo 的 `guest_access` 与维护锁设置。
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

## 1.3 项目访问权限

管理员在后台打开项目，在“项目访问权限”选择“公开 · 不用登录”或“需登录 · 登录后查看”，点击“保存权限”；面板显示服务器已经保存的状态。保存失败保留选择，不把草稿当作已生效。现有项目及新项目均默认公开，迁移不批量改变访问范围。

POST yudaoDesign.projects.configure 新增可选 visibility=public|login，仍要求原生管理员会话及 pwg_token；缺省保持当前权限，非法值拒绝且事务回滚。权限保存在增量 project_access 表，不修改原版本文档或文件。公开项目游客可看；需登录项目从游客列表隐藏，详情 API 返回401错误；页面显示登录及返回原项目的入口。文件、400/800预览及完整互动模型目录内所有依赖在缓存/HEAD/Range/304之前检查项目权限。普通登录账号可读，权限和上传/修改仍只允许管理员。

公开资源使用no-cache重新校验，需登录资源使用private,no-store，并按Cookie区分会话；磁盘缩略图缓存保留。CLI预热与备份全量清单使用本地原生管理员身份，隔离恢复使用备份中的管理员凭证验证全部项目（包括需登录项目），不将凭证写入报告。

权限适用于此资料库入口及它提供的下载/模型链接。旧8080静态网站和已经下载到同事电脑的副本属于独立发布，不由此开关撤回。回滚至1.2会失去项目访问控制；已经设置需登录时，应修复1.3或使用含权限的发布版本恢复，不能把回滚旧插件当成保持权限的保证。
