<?php
define('PHPWG_ROOT_PATH', '../../');
define('YUDAO_DESIGN_ENTRY', true);
require_once PHPWG_ROOT_PATH.'include/common.inc.php';
check_status(ACCESS_GUEST);
if (!isset($pwg_loaded_plugins['yudao_design'])) { http_response_code(404); exit('设计资料插件尚未启用。'); }
require_once __DIR__.'/include/page.php';
try {
  if (!empty($_GET['project'])) {
    if (!yudao_design_valid_id($_GET['project'])) throw new YudaoDesignError('项目编号无效。', 400);
    yudao_design_require_project_access($_GET['project']);
  }
} catch (YudaoDesignError $e) {
  http_response_code($e->getCode()); header('Content-Type: text/html; charset=utf-8'); header('Cache-Control: private, no-store');
  $login = htmlspecialchars(yudao_design_login_url($_GET['project'] ?? ''), ENT_QUOTES, 'UTF-8');
  echo '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>项目访问</title><body><main style="max-width:520px;margin:10vh auto;padding:24px;font-family:system-ui"><h1>'.htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8').'</h1>'.($e->getCode() === 401 ? '<p>登录后可查看该项目的全部版本和资料。</p><a href="'.$login.'">登录并查看项目</a>' : '').'</main></body></html>';
  exit;
}
yudao_design_render_page(false);
