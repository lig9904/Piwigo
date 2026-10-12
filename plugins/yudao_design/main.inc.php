<?php
/*
Plugin Name: 渔岛设计资料
Version: 1.2.0
Description: 项目版本统一上传、图片与三维模型预览、PDF 查看及 CAD 下载。
Author: Yudao
Has Settings: true
*/
defined('PHPWG_ROOT_PATH') or die('Access denied');
global $conf;
require_once __DIR__.'/include/library.php';
// Core's empty-photo welcome screen must not intercept this plugin's own pages.
// Keep it unchanged for the native gallery and all other scripts.
if (defined('YUDAO_DESIGN_ENTRY')) $conf['no_photo_yet'] = false;
add_event_handler('ws_add_methods', 'yudao_design_register_methods');
add_event_handler('init', 'yudao_design_check_request_size');

function yudao_design_register_methods($arr)
{
  $service = &$arr[0];
  $service->addMethod('yudaoDesign.projects.list', 'yudao_design_ws_list', array(), '获取设计项目');
  $service->addMethod('yudaoDesign.projects.get', 'yudao_design_ws_get', array('project_id' => array()), '获取项目和已发布版本');
  $service->addMethod('yudaoDesign.projects.import', 'yudao_design_ws_import', array(
    'title' => array(), 'region' => array('default' => ''), 'version' => array(),
    'description' => array('default' => ''), 'project_id' => array('default' => ''),
    'manifest' => array('default' => '[]'), 'request_id' => array('default' => ''), 'pwg_token' => array(),
  ), '一次提交 files[] 和项目版本信息，全部保存成功后发布', '', array('admin_only' => true, 'post_only' => true));
  $service->addMethod('yudaoDesign.projects.configure', 'yudao_design_ws_configure', array(
    'project_id' => array(), 'current_version_id' => array('default' => null),
    'cover_asset_id' => array('default' => null), 'interactive_models' => array('default' => null), 'pwg_token' => array(),
  ), '设置项目当前版本、封面与交互模型；缺省字段保持原值', '', array('admin_only' => true, 'post_only' => true));
  $service->addMethod('yudaoDesign.projects.annotate', 'yudao_design_ws_annotate', array(
    'project_id' => array(), 'captions' => array('default' => '{}'), 'pwg_token' => array(),
  ), '保存项目图片说明，缺省保留、空字符串删除', '', array('admin_only' => true, 'post_only' => true));
}

function yudao_design_check_request_size()
{
  if (defined('IN_WS') && isset($_GET['method']) && $_GET['method'] === 'yudaoDesign.projects.import')
  {
    $php_max = yudao_design_limits()['request_max_bytes'];
    if ($php_max > 0 && (int)($_SERVER['CONTENT_LENGTH'] ?? 0) > $php_max)
    {
      http_response_code(413);
      header('Content-Type: application/json; charset=utf-8');
      echo json_encode(array('stat' => 'fail', 'err' => 413, 'message' => '上传超过服务器容量限制，请减少文件或分成新的项目版本。'), JSON_UNESCAPED_UNICODE);
      exit;
    }
  }
}

function yudao_design_ws_list($params, $service)
{
  check_status(ACCESS_GUEST);
  try { return array('projects' => yudao_design_list_projects(), 'limits' => yudao_design_limits()); }
  catch (Throwable $e) { return new PwgError(500, '项目库暂时无法读取，请确认插件已启用。'); }
}

function yudao_design_ws_get($params, $service)
{
  check_status(ACCESS_GUEST);
  try { return array('project' => yudao_design_get_project(stripslashes($params['project_id'])), 'limits' => yudao_design_limits()); }
  catch (YudaoDesignError $e) { return new PwgError($e->getCode(), $e->getMessage()); }
  catch (Throwable $e) { return new PwgError(500, '项目暂时无法读取。'); }
}

function yudao_design_ws_import($params, $service)
{
  if (!is_admin() || !hash_equals(get_pwg_token(), (string)$params['pwg_token']))
    return new PwgError(403, '请登录管理员账户后重新上传。');
  try {
    foreach ($params as &$value) { if (is_string($value)) $value = stripslashes($value); }
    unset($value);
    return yudao_design_import($params, $_FILES['files'] ?? array());
  }
  catch (YudaoDesignError $e) { return new PwgError($e->getCode(), $e->getMessage()); }
  catch (Throwable $e) {
    error_log('Yudao design import failed: '.get_class($e));
    return new PwgError(500, '保存未完成，资料没有发布。请检查存储空间和数据库后重试。');
  }
}

function yudao_design_ws_configure($params, $service)
{
  if (!is_admin() || !hash_equals(get_pwg_token(), (string)($params['pwg_token'] ?? '')))
    return new PwgError(403, '请登录管理员账户后保存展示设置。');
  try {
    foreach ($params as &$value) { if (is_string($value)) $value = stripslashes($value); }
    unset($value);
    return yudao_design_configure($params);
  }
  catch (YudaoDesignError $e) { return new PwgError($e->getCode(), $e->getMessage()); }
  catch (Throwable $e) {
    error_log('Yudao design settings failed: '.get_class($e));
    return new PwgError(500, '展示设置暂时无法保存，请稍后重试。');
  }
}

function yudao_design_ws_annotate($params, $service)
{
  if (!is_admin() || !hash_equals(get_pwg_token(), (string)($params['pwg_token'] ?? '')))
    return new PwgError(403, '请登录管理员账户后保存图片说明。');
  try {
    foreach ($params as &$value) { if (is_string($value)) $value = stripslashes($value); }
    unset($value);
    return yudao_design_annotate($params);
  }
  catch (YudaoDesignError $e) { return new PwgError($e->getCode(), $e->getMessage()); }
  catch (Throwable $e) {
    error_log('Yudao caption save failed: '.get_class($e));
    return new PwgError(500, '图片说明暂时无法保存，请稍后重试。');
  }
}
