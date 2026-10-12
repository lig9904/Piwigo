<?php
define('PHPWG_ROOT_PATH', '../../');
define('YUDAO_DESIGN_ENTRY', true);
require_once PHPWG_ROOT_PATH.'include/common.inc.php';
check_status(ACCESS_GUEST);
if (!isset($pwg_loaded_plugins['yudao_design'])) { http_response_code(404); exit; }
try {
  $version_id = $_GET['version_id'] ?? '';
  $asset_id = $_GET['asset_id'] ?? '';
  if (!yudao_design_valid_id($version_id) || !yudao_design_valid_id($asset_id)) throw new YudaoDesignError('文件编号无效。', 400);
  $row = yudao_design_query('SELECT document FROM '.yudao_design_table('versions').' WHERE id=?', 's', array($version_id))->get_result()->fetch_assoc();
  if (!$row) throw new YudaoDesignError('文件尚未发布或不存在。', 404);
  $version = json_decode($row['document'], true, 512, JSON_THROW_ON_ERROR);
  $asset = null;
  foreach ($version['assets'] as $candidate) if ($candidate['id'] === $asset_id) $asset = $candidate;
  if (!$asset || basename($asset['file']) !== $asset['file']) throw new YudaoDesignError('文件不存在。', 404);
  $root = yudao_design_storage();
  $path = realpath($root.'/'.$version_id.'/'.$asset['file']);
  if (!$path || strpos($path, $root.'/'.$version_id.'/') !== 0 || !is_file($path)) throw new YudaoDesignError('原文件暂时不可读取。', 404);
  $size = filesize($path); $start = 0; $end = $size-1;
  $etag = '"'.$asset['sha256'].'"';
  if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag && !isset($_SERVER['HTTP_RANGE'])) { http_response_code(304); exit; }
  if (isset($_SERVER['HTTP_RANGE'])) {
    if (!preg_match('/\Abytes=(\d*)-(\d*)\z/', $_SERVER['HTTP_RANGE'], $m) || ($m[1] === '' && $m[2] === '')) {
      header('Content-Range: bytes */'.$size); http_response_code(416); exit;
    }
    if ($m[1] === '') { $start = max(0, $size-(int)$m[2]); }
    else { $start = (int)$m[1]; if ($m[2] !== '') $end = min($end, (int)$m[2]); }
    if ($start > $end || $start >= $size) { header('Content-Range: bytes */'.$size); http_response_code(416); exit; }
    http_response_code(206); header('Content-Range: bytes '.$start.'-'.$end.'/'.$size);
  }
  $attachment = in_array($asset['kind'], array('cad', 'document'), true) || isset($_GET['download']);
  header('Content-Type: '.$asset['mime']);
  header('X-Content-Type-Options: nosniff');
  header('Content-Disposition: '.($attachment ? 'attachment' : 'inline').'; filename="download.'.pathinfo($asset['file'], PATHINFO_EXTENSION).'"; filename*=UTF-8\'\''.rawurlencode($asset['name']));
  header('Accept-Ranges: bytes'); header('ETag: '.$etag); header('Cache-Control: public, max-age=3600');
  header('Content-Length: '.($end-$start+1));
  session_write_close();
  if ($_SERVER['REQUEST_METHOD'] === 'HEAD') exit;
  $file = fopen($path, 'rb'); fseek($file, $start); $remaining = $end-$start+1;
  while ($remaining > 0 && !feof($file) && !connection_aborted()) { $chunk = fread($file, min(1048576, $remaining)); echo $chunk; $remaining -= strlen($chunk); }
  fclose($file);
} catch (YudaoDesignError $e) { http_response_code($e->getCode()); header('Content-Type: text/plain; charset=utf-8'); echo $e->getMessage(); }
catch (Throwable $e) { http_response_code(500); header('Content-Type: text/plain; charset=utf-8'); echo '文件暂时无法读取。'; }
