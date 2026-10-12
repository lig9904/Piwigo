# 渔岛温泉 Piwigo 本地部署

本部署将 Piwigo 和 MariaDB 放在独立的 Docker Compose 项目中。网页默认只监听本机 `127.0.0.1:8780`，数据库没有对外发布端口。首次打开安装向导后，由用户自行设置中文管理员账号和密码；部署不会创建管理员，也不会自动订阅邮件。

站点根路径 `/` 会由 Apache 返回 302 并跳转到 `/plugins/yudao_design/project.php`；`/index.php` 和 `/install.php` 保持原有访问路径。

Dockerfile 使用官方 PHP 8.3 Apache 多架构基础镜像，数据库使用官方 MariaDB 镜像。本机 Apple Silicon 验证会生成 ARM64 镜像；NAS 使用单独的 AMD64 Compose 配置和镜像。本机成功不代表 NAS 已部署或通过 NAS 验收。

NAS 调试跳板部署使用 `compose.nas.yaml`，应用镜像名为 `yudao-piwigo:16.4-design`，端口为 `8081`。Piwigo 网页文件、MariaDB 数据和设计资料分别绑定到 `/vol1/1000/yudao-piwigo/html`、`/vol1/1000/yudao-piwigo/database` 和 `/vol2/1000/design-library/materials`。该配置固定 `linux/amd64`：先将基础镜像 tar 导入 NAS，并把源码 zip 解压到 `/vol1/1000/yudao-piwigo/source`，再在 NAS 准备 `.env` 凭证文件并运行 Compose，由 NAS 原生 Docker 构建应用镜像。XMT 目录只用于接收安装调试包，不用作网站或资料运行目录。

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

```sh
docker --context colima-yudao-piwigo compose --env-file ../piwigo-runtime-evidence/yudao-piwigo.env -f deploy/yudao/compose.yaml ps
docker --context colima-yudao-piwigo compose --env-file ../piwigo-runtime-evidence/yudao-piwigo.env -f deploy/yudao/compose.yaml logs -f piwigo
docker --context colima-yudao-piwigo compose --env-file ../piwigo-runtime-evidence/yudao-piwigo.env -f deploy/yudao/compose.yaml down
```

`down` 会停止并移除容器；命名卷保留。删除卷会永久删除相应图库或数据库，请在确认备份后单独操作。
