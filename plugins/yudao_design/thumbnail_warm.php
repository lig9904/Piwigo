<?php
// Run from the Piwigo root: php plugins/yudao_design/thumbnail_warm.php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
// Native Piwigo session bootstrap expects an IPv4 address even in CLI mode.
$_SERVER['REMOTE_ADDR'] = '127.0.0.1';
$_SERVER['HTTP_HOST'] = 'localhost';
define('PHPWG_ROOT_PATH', './');
define('YUDAO_DESIGN_ENTRY', true);
require_once PHPWG_ROOT_PATH.'include/common.inc.php';
if (!isset($pwg_loaded_plugins['yudao_design'])) { fwrite(STDERR, "Plugin not enabled\n"); exit(1); }
require_once __DIR__.'/include/thumbnail.php';
$counts = array('images' => 0, 'generated' => 0, 'hits' => 0, 'fallbacks' => 0);
$rows = yudao_design_query('SELECT id,document FROM '.yudao_design_table('versions'))->get_result();
while ($row = $rows->fetch_assoc()) {
  $version = json_decode($row['document'], true, 512, JSON_THROW_ON_ERROR);
  foreach ($version['assets'] as $asset) {
    if ($asset['kind'] !== 'image') continue;
    $counts['images']++;
    try {
      list($resolved, $path) = yudao_design_resolve_asset($row['id'], $asset['id']);
      foreach (array(400, 800) as $size) {
        $preview = yudao_design_thumbnail($resolved, $path, $size);
        $counts[$preview ? ($preview['hit'] ? 'hits' : 'generated') : 'fallbacks']++;
      }
    } catch (Throwable $e) { $counts['fallbacks'] += 2; }
  }
}
echo json_encode($counts, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n";
exit($counts['fallbacks'] ? 2 : 0);
