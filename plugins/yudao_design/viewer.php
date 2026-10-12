<?php
// Preserve original interactive HTML and relative resources through PATH_INFO.
define('PHPWG_ROOT_PATH', '../../');
define('YUDAO_DESIGN_ENTRY', true);
require_once PHPWG_ROOT_PATH.'include/common.inc.php';
check_status(ACCESS_GUEST);
if (!isset($pwg_loaded_plugins['yudao_design'])) { http_response_code(404); exit; }

try {
  header('Cache-Control: private, no-store');
  $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
  if (!in_array($method, array('GET', 'HEAD'), true)) {
    header('Allow: GET, HEAD');
    throw new YudaoDesignError('仅支持读取互动模型。', 405);
  }
  // PHP decodes PATH_INFO once; do not decode again (encoded traversal ambiguity).
  $relative = $_SERVER['PATH_INFO'] ?? '';
  if ($relative === '' || $relative[0] !== '/' || preg_match('/[\\\\\x00-\x1f\x7f]/', $relative))
    throw new YudaoDesignError('互动模型路径无效。', 400);
  $parts = explode('/', substr($relative, 1));
  foreach ($parts as $part) {
    if ($part === '' || $part === '.' || $part === '..' || $part[0] === '.')
      throw new YudaoDesignError('互动模型路径无效。', 400);
  }
  if (count($parts) < 3 || $parts[0] !== 'model') throw new YudaoDesignError('互动模型路径无效。', 404);
  $visibility = yudao_design_require_viewer_access($parts[1]);
  $mime = array(
    'html' => 'text/html; charset=utf-8', 'htm' => 'text/html; charset=utf-8',
    'js' => 'application/javascript; charset=utf-8', 'mjs' => 'application/javascript; charset=utf-8',
    'css' => 'text/css; charset=utf-8', 'json' => 'application/json; charset=utf-8',
    'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
    'gif' => 'image/gif', 'webp' => 'image/webp', 'svg' => 'image/svg+xml',
    'glb' => 'model/gltf-binary', 'gltf' => 'model/gltf+json',
    'bin' => 'application/octet-stream', 'wasm' => 'application/wasm',
    'woff' => 'font/woff', 'woff2' => 'font/woff2', 'ttf' => 'font/ttf',
    'mp4' => 'video/mp4', 'webm' => 'video/webm', 'mp3' => 'audio/mpeg',
    'ogg' => 'audio/ogg', 'wav' => 'audio/wav', 'pdf' => 'application/pdf',
    'dwg' => 'application/acad', 'dxf' => 'application/dxf',
  );
  $extension = strtolower(pathinfo(end($parts), PATHINFO_EXTENSION));
  if (!isset($mime[$extension])) throw new YudaoDesignError('互动模型文件类型不受支持。', 404);
  $storage = yudao_design_storage();
  $root = realpath($storage.'/interactive');
  if (!$root || strpos($root, $storage.DIRECTORY_SEPARATOR) !== 0)
    throw new YudaoDesignError('互动模型尚未发布。', 404);
  $path = realpath($root.'/'.$relative);
  $model_root = $root.'/model/'.$parts[1];
  if (realpath($model_root) !== $model_root || !$path || strpos($path, $model_root.DIRECTORY_SEPARATOR) !== 0 || !is_file($path) || !is_readable($path))
    throw new YudaoDesignError('互动模型文件不存在。', 404);
  $size = filesize($path);
  $etag = '"'.hash_file('sha256', $path).'"';
  header('Content-Type: '.$mime[$extension]);
  header('X-Content-Type-Options: nosniff');
  yudao_design_cache_headers($visibility);
  header('ETag: '.$etag);
  header('Accept-Ranges: bytes');
  if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag && !isset($_SERVER['HTTP_RANGE'])) {
    http_response_code(304); exit;
  }
  $start = 0; $end = $size-1;
  if (isset($_SERVER['HTTP_RANGE'])) {
    if (!preg_match('/\Abytes=(\d*)-(\d*)\z/', $_SERVER['HTTP_RANGE'], $range)
      || ($range[1] === '' && $range[2] === '') || $size === 0
      || ($range[1] === '' && (int)$range[2] === 0)) {
      header('Content-Range: bytes */'.$size); http_response_code(416); exit;
    }
    if ($range[1] === '') $start = max(0, $size-(int)$range[2]);
    else { $start = (int)$range[1]; if ($range[2] !== '') $end = min($end, (int)$range[2]); }
    if ($start > $end || $start >= $size) {
      header('Content-Range: bytes */'.$size); http_response_code(416); exit;
    }
    http_response_code(206); header('Content-Range: bytes '.$start.'-'.$end.'/'.$size);
  }
  header('Content-Length: '.max(0, $end-$start+1));
  session_write_close();
  if ($method === 'HEAD') exit;
  $file = fopen($path, 'rb');
  if (!$file) throw new YudaoDesignError('互动模型暂时无法读取。', 503);
  fseek($file, $start); $remaining = max(0, $end-$start+1);
  while ($remaining > 0 && !feof($file) && !connection_aborted()) {
    $chunk = fread($file, min(1048576, $remaining));
    if ($chunk === false || $chunk === '') break;
    echo $chunk; $remaining -= strlen($chunk);
  }
  fclose($file);
} catch (YudaoDesignError $e) {
  http_response_code($e->getCode()); header('Content-Type: text/plain; charset=utf-8');
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'HEAD') echo $e->getMessage();
} catch (Throwable $e) {
  http_response_code(500); header('Content-Type: text/plain; charset=utf-8');
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'HEAD') echo '互动模型暂时无法读取。';
}
