<?php
defined('PHPWG_ROOT_PATH') or die('Access denied');
check_status(ACCESS_ADMINISTRATOR);
require_once __DIR__.'/include/page.php';
$template->assign('YUDAO_LIBRARY', yudao_design_page_markup(true));
$template->set_filenames(array('plugin_admin_content' => __DIR__.'/template/admin.tpl'));
$template->assign_var_from_handle('ADMIN_CONTENT', 'plugin_admin_content');
