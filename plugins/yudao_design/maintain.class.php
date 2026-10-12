<?php
defined('PHPWG_ROOT_PATH') or die('Access denied');
require_once __DIR__.'/include/library.php';
class yudao_design_maintain extends PluginMaintain
{
  function install($plugin_version, &$errors = array())
  {
    try { yudao_design_schema(); }
    catch (Throwable $e) { $errors[] = '渔岛设计资料建表失败，请检查数据库权限。'; }
  }
  function activate($plugin_version, &$errors = array()) { $this->install($plugin_version, $errors); }
  function update($old_version, $new_version, &$errors = array()) { $this->install($new_version, $errors); }
  // Deactivation and uninstall preserve business records and original uploads.
  function deactivate() {}
  function uninstall() {}
}
