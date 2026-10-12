<?php
defined('PHPWG_ROOT_PATH') or die('Access denied');
function yudao_design_page_markup($admin)
{
  $base = get_absolute_root_url();
  $config = array('apiUrl' => $base.'ws.php?format=json', 'baseUrl' => $base.'plugins/yudao_design/project.php',
    'canUpload' => is_admin(), 'token' => is_admin() ? get_pwg_token() : '', 'limits' => yudao_design_limits());
  $json = htmlspecialchars(json_encode($config, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), ENT_QUOTES, 'UTF-8');
  $assets = htmlspecialchars($base.'plugins/yudao_design/', ENT_QUOTES, 'UTF-8');
  return '<link rel="stylesheet" href="'.$assets.'assets/library.css?v=1.0.0">'
    .'<div id="yudao-design-app" data-config="'.$json.'"></div>'
    .'<script type="module" src="'.$assets.'vendor/model-viewer.min.js"></script>'
    .'<script defer src="'.$assets.'assets/library.js?v=1.0.0"></script>';
}
function yudao_design_render_page($admin)
{
  header('Content-Type: text/html; charset=utf-8');
  header('Cache-Control: no-store');
  $base = htmlspecialchars(get_absolute_root_url(), ENT_QUOTES, 'UTF-8');
  echo '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="'.$base.'themes/default/icon/favicon.ico"><title>渔岛 · 设计资料库</title></head><body>';
  echo '<nav class="yd-site-nav"><a href="'.$base.'index.php">Piwigo 相册</a> <a href="'.$base.(is_admin() ? 'admin.php?page=plugin-yudao_design' : 'identification.php').'">'.(is_admin() ? '资料管理' : '管理员登录').'</a></nav>';
  echo yudao_design_page_markup($admin).'</body></html>';
}
