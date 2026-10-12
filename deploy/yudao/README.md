# 渔岛温泉 Piwigo 本地部署

本部署将 Piwigo 和 MariaDB 放在独立的 Docker Compose 项目中。网页默认只监听本机 `127.0.0.1:8780`，数据库没有对外发布端口。首次打开安装向导后，由用户自行设置中文管理员账号和密码；部署不会创建管理员，也不会自动订阅邮件。

站点根路径 `/` 会由 Apache 返回 302 并跳转到 `/plugins/yudao_design/project.php`；`/index.php` 和 `/install.php` 保持原有访问路径。

Dockerfile 使用官方 PHP 8.3 Apache 多架构基础镜像，数据库使用官方 MariaDB 镜像。本机 Apple Silicon 验证会生成 ARM64 镜像；NAS 使用单独的 AMD64 Compose 配置和镜像。本机成功不代表 NAS 已部署或通过 NAS 验收。

NAS 调试跳板部署使用 `compose.nas.yaml`，应用镜像名为 `yudao-piwigo:16.4-design`，端口为 `8081`。Piwigo 网页文件、MariaDB 数据和设计资料分别绑定到 `/vol1/1000/yudao-piwigo/html`、`/vol1/1000/yudao-piwigo/database` 和 `/vol2/1000/design-library/materials`。该配置固定 `linux/amd64`：先将基础镜像 tar 导入 NAS，并把源码 zip 解压到 `/vol1/1000/yudao-piwigo/source`，再在 NAS 准备 `.env` 凭证文件并运行 Compose，由 NAS 原生 Docker 构建应用镜像。XMT 目录只用于接收安装调试包，不用作网站或资料运行目录。

更新已有飞牛项目时使用实际登记的 Compose 项目名。本机 NAS 项目登记为 `yudao-piwigo`，终端更新需显式传 `-p yudao-piwigo`，避免按配置文件默认名创建第二个项目并发生端口冲突。Dockerfile 专属忽略文件优先于根目录忽略文件，隔离测试和证据须在 `deploy/yudao/Dockerfile.dockerignore` 中排除。

## 准备密码并启动

在仓库根目录执行。请将密码文件放在仓库以外，并为两个密码分别生成随机值：

```sh
umask 077
mkdir -p ../piwigo-runtime-evidence
cp deploy/yudao/.env.example ../piwigo-runtime-evidence/yudao-piwigo.env
${EDITOR:-vi} ../piwigo-runtime-evidence/yudao-piwigo.env
docker --context colima-yudao-piwigo compose --env-file ../piwigo-runtime-evidence/yudao-piwigo.env -f deploy/yudao/compose.yaml up -d --build
```

浏览器打开 <http://127.0.0.1:8780/install.php>，按向导连接数据库：主机填写 `database`，数据库名和用户名填写 `piwigo`，密码填写 env 文件中的 `PIWIGO_DB_PASSWORD`。向导中将站点名称设置为中文，并自行设置管理员账号和密码。

## 持久化内容

本地 Compose 使用三个独立命名卷：数据库卷保存 MariaDB 数据；Piwigo 网页卷保存安装后的配置、图库和照片；设计资料卷挂载在 `/var/lib/yudao-design`，容器环境变量 `YUDAO_STORAGE_ROOT` 指向该路径。NAS 调试跳板 Compose 将这三类数据保存到上列绑定目录。首次启动会将镜像内的仓库复制到网页目录；后续启动只刷新 `plugins/yudao_design` 插件代码，保留 Piwigo 核心、安装配置、照片和其他插件。

## 常用操作

### 1.1 项目展示与分享

项目页按全部版本汇总资料，提供完整互动模型与 GLB 预览入口；当前版本仍保留独立的影像、PDF、CAD 和配色文件。完整互动模型使用原 HTML/Three.js 页面及原样依赖，素材位于 `YUDAO_STORAGE_ROOT/interactive/`，通过插件 `viewer.php` 提供，不能依赖 XMT 安装跳板。

管理员可设置默认展示版本和项目封面。后续补传资料保留原设置；版本切换及复制链接带 `project` 和 `version`，刷新或分享后仍打开选定版本。公开浏览保持无需登录。

升级插件至 1.1.0 后运行插件数据库更新（或在已有 Piwigo bootstrap 下调用 `yudao_design_schema()`），新增展示设置与上传请求表，不改动原项目、版本及素材。发布前保留数据库、原插件和旧镜像。

统一上传接口接受可选 UUID `request_id`。同一请求重试须使用相同编号及相同文件、字段；已保存请求返回原保存回执，内容变化返回 409。批量导入可在 manifest 中提供 `request_id`。返回 `saved=true`、`project_id`、`version_id` 即表示已保存；`project=null` 和 `warning` 仅表示详情读取失败，不应重复创建版本。

`yudaoDesign.projects.configure` 使用管理员会话与 `pwg_token`，支持 `current_version_id`、`cover_asset_id`、`interactive_models`。省略字段保留原值，显式空串清除版本/封面设置，`interactive_models=[]` 清除互动入口；所有引用必须属于本项目，互动地址限定插件本地查看器。

```sh
docker --context colima-yudao-piwigo compose --env-file ../piwigo-runtime-evidence/yudao-piwigo.env -f deploy/yudao/compose.yaml ps
docker --context colima-yudao-piwigo compose --env-file ../piwigo-runtime-evidence/yudao-piwigo.env -f deploy/yudao/compose.yaml logs -f piwigo
docker --context colima-yudao-piwigo compose --env-file ../piwigo-runtime-evidence/yudao-piwigo.env -f deploy/yudao/compose.yaml down
```

`down` 会停止并移除容器；命名卷保留。删除卷会永久删除相应图库或数据库，请在确认备份后单独操作。

### 1.2 图片、比较和上传边界

列表和图片卡使用最大边 400/800 的派生预览，原图灯箱及下载仍读取原附件。缓存保存在资料目录 `.previews/`，按原 SHA、尺寸和缓存格式版本分开，失败返回原图。可用 Web 用户预热：

```sh
docker exec -u www-data -w /var/www/html yudao-piwigo-piwigo-1 php plugins/yudao_design/thumbnail_warm.php
```

双图比较从本项目所有版本明确选择两张图，保留版本、现场/效果角色和原文件名；手机上下排列。管理员可补充最长 240 个 Unicode 码点的图片说明；说明存独立表，不改变原文件、版本文档或 SHA。接口 `POST yudaoDesign.projects.annotate` 接受 `project_id`、`captions` JSON 对象和 `pwg_token`；缺省资产保留，空串删除。保存回执沿用 `saved=true` 与可空 `project/warning`。

`list/get` 和页面统一读 PHP 实际限额。CSV/TXT 不超过 16 MiB，通用单文件不超过 512 MiB，版本说明不超过 10,000 码点，至多 64 文件；总请求至多 1 GiB，附件总量扣除 2 MiB 表单开销，服务器较低时取较低值。发布时显式运行 schema，插件版本更新为 1.2.0。

### 完整备份与隔离恢复

以下脚本只针对上述项目，不操作其他 NAS 服务。备份会短暂停止此项目网页容器，数据库保持运行；网页恢复后继续镜像归档和恢复演练。数据库、网站配置/相册、原素材/互动模型、部署配置、源码、数据库初始化凭证和镜像都纳入备份；预览缓存可重建，因此排除。备份含密码，必须留在 NAS 的 root 0700 目录、文件 0600，不能上传 GitHub 或移入公开共享目录。

```sh
python3 tools/yudao/backup_restore.py /vol2/1000/design-library/backups/RELEASE-before --verify-restore
python3 tools/yudao/backup_restore.py /vol2/1000/design-library/backups/RELEASE-before --restore-only
```

目标目录不能存在，且不能放入被备份的素材、网站或源码树中。恢复使用新建网络、容器和目录，端口仅绑定回环；核验数据库项目/版本/原文件信息、默认版本/封面/互动入口/说明，以及每个原文件的实际下载 SHA 和完整互动 HTML。演练结束清理本次创建的对象。`restore-only` 使用备份内的历史凭证，镜像缺失时从备份载入，不依赖正在运行的数据库。需要 Chrome 对模型操作/PDF渲染的验证须另行完成，脚本的 HTML/SHA 检查不能代替浏览器交互验收。

备份与发布共用 `.backup.lock`，同时运行会拒绝；没有自动创建定时任务。当前备份位于同一 NAS，异地灾备尚未配置。

### 可追踪发布与回滚

每次发布使用新的镜像标签（如 `yudao-piwigo:1.2.0-REVISION`），先验证标签不存在，再构建；不能覆盖既有发布标签。构建传入实际提交和版本：

```sh
docker build --build-arg YUDAO_RELEASE=1.2.0 --build-arg YUDAO_SOURCE_REVISION=COMMIT -f deploy/yudao/Dockerfile -t yudao-piwigo:1.2.0-REVISION .
python3 tools/yudao/switch_release.py yudao-piwigo:1.2.0-REVISION
```

OCI 标签记录提交和发布版本；`plugins/yudao_design/release.json` 显示实际提供插件的镜像身份。切换脚本只替换登记项目 `yudao-piwigo` 的应用镜像，保留端口、数据库、目录和其他服务；启动完成后运行增量 schema 并核对正在运行的镜像 ID。失败时恢复原 Compose，等待原 API 并核对镜像，写入 `rollbackVerified` 回执。凭证不写到回执。

回滚使用相同脚本选择已保留旧镜像。1.2 新表是增量结构，旧插件仍可读原数据库；若未来涉及破坏性迁移，须先隔离验证备份恢复，不能直接套用代码回滚。Piwigo 核心文件仍保留持久卷里的原版本，更新镜像只更新此插件；核心版本升级须使用原生 Piwigo 升级流程并单独验收，不能把镜像标签当作核心已升级的证据。
