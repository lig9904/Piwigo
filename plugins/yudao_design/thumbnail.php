<?php
define('PHPWG_ROOT_PATH', '../../');
define('YUDAO_DESIGN_ENTRY', true);
require_once PHPWG_ROOT_PATH.'include/common.inc.php';
check_status(ACCESS_GUEST);
if (!isset($pwg_loaded_plugins['yudao_design'])) { http_response_code(404); exit; }
require_once __DIR__.'/include/thumbnail.php';
try { yudao_design_serve_thumbnail($_GET['version_id'] ?? '', $_GET['asset_id'] ?? '', $_GET['size'] ?? ''); }
catch (YudaoDesignError $e) { http_response_code($e->getCode()); header('Content-Type: text/plain; charset=utf-8'); echo $e->getMessage(); }
catch (Throwable $e) { http_response_code(500); header('Content-Type: text/plain; charset=utf-8'); echo '图片暂时无法读取。'; }
