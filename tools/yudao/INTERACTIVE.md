# 原互动模型交付

`plugins/yudao_design/viewer.php` 与 `project.php`、`file.php` 使用相同的 Piwigo 初始化、`ACCESS_GUEST` 和插件启用检查。服务只读取 `yudao_design_storage()/interactive`，不查询或修改业务数据库。

入口采用 PATH_INFO，原 HTML 内的相对脚本、模型下载和图片链接自动保留原层级：

- `plugins/yudao_design/viewer.php/model/covered-terrace-r26/R26檐下露台及日式外观.html`
- `plugins/yudao_design/viewer.php/model/site-r03/场地景观模型.html`

服务支持 GET、HEAD、SHA256 ETag、单段 Range 以及 HTML/JS/JSON/图片/GLB 等静态 MIME。它不执行运行素材中的 PHP；扩展白名单、隐藏路径拒绝、路径段检查和 realpath 边界共同限制可读取范围。运行素材应仅放置已批准公开的静态资料。服务器必须将 `viewer.php/...` 作为 PHP PATH_INFO 处理；独立生产验收须通过实际服务器检查。

## 本地准备

从原静态站点根目录指定两份原 HTML，递归收集 HTML 引用、CSS 资源、字面量 import/fetch/loader 资源与 glTF 外部资源。脚本不改写原 HTML 或脚本，发现外部依赖时停止；动态拼接 URL 须在浏览器加载检查中补验。

```sh
python3 tools/yudao/prepare_interactive.py \
  --source-root /path/to/original/site \
  --output /path/to/new/local-stage
```

输出包括：

- `materials/interactive/`：保持原目录和中文文件名的部署素材。
- `manifest.json`：完整文件名单、依赖边、每文件源 SHA256 与复制后 SHA256。
- `interactive-models.json`：两项 `{key,label,version_id,url}` 配置。
- `interactive-materials.tar` 和 `package.sha256`：稳定元数据的独立素材包与 SHA256。

只将 PHP 服务、准备脚本和说明加入代码仓库；模型及私有资料包保存在独立工作区。安装时由负责部署者将 archive 内 `interactive/` 解包到配置的资料目录，不通过 NFS/XMT 运行读取，不复制整站其他文件。

## 验收边界

本次两页合计 9 个引用闭包文件（R26 页 3 个、场地页 6 个），不包含未被页面引用的 DWG/DXF。原站及隔离新入口均应逐项验证 R26 的 17 个视角、R14/R26、四扇门、遮光、昼夜，以及场地的 5 个视角、道路绿化/CAD/屋顶；同时核对每个 HTTP 文件的哈希、HEAD、MIME 和拒绝路径。

隔离测试 bootstrap 不接真实数据库，因此仅证明文件服务和浏览器素材运行。生产 Piwigo 权限、Web 服务器 PATH_INFO、实际页面嵌入及正式发布地址须由主流程在生产入口独立验收。
