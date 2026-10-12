<?php
define('PHPWG_ROOT_PATH', '../../');
define('YUDAO_DESIGN_ENTRY', true);
require_once PHPWG_ROOT_PATH.'include/common.inc.php';
check_status(ACCESS_GUEST);
if (!isset($pwg_loaded_plugins['yudao_design'])) { http_response_code(404); exit('设计资料插件尚未启用。'); }
require_once __DIR__.'/include/page.php';
yudao_design_render_page(false);
