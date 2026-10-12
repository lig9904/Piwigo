<?php
defined('PHPWG_ROOT_PATH') or die('Access denied');

// Original assets are immutable. Preview output lives outside the web root and
// is served only after the endpoint resolves a published, readable image.
function yudao_design_thumbnail($asset, $source, $size)
{
  if ($asset['kind'] !== 'image' || !in_array($size, array(400, 800), true))
    throw new YudaoDesignError('仅图片支持 400 或 800 像素预览。', 400);
  $extensions = array('image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp');
  if (!isset($extensions[$asset['mime']]) || !preg_match('/\A[a-f0-9]{64}\z/', $asset['sha256'])) return null;
  $root = yudao_design_storage();
  $directory = $root.'/.previews';
  if (is_link($directory) || (!is_dir($directory) && !@mkdir($directory, 0750) && !is_dir($directory))) return null;
  if (realpath($directory) !== $directory) return null;
  $cache = $directory.'/'.$asset['sha256'].'-'.$size.'-v1.'.$extensions[$asset['mime']];
  // No decoding or hashing of the original on cache hits.
  if (is_file($cache) && !is_link($cache) && is_readable($cache) && filesize($cache) > 0) return array('path' => $cache, 'mime' => $asset['mime'], 'hit' => true);
  if (!extension_loaded('gd') || !is_writable($directory)) return null;
  $lock_path = $cache.'.lock';
  if (is_link($lock_path)) return null;
  $lock = @fopen($lock_path, 'c');
  if (!$lock) return null;
  $input = null; $output = null; $temporary = null;
  try {
    if (!flock($lock, LOCK_EX)) return null;
    clearstatcache(true, $cache);
    if (is_file($cache) && !is_link($cache) && is_readable($cache) && filesize($cache) > 0) return array('path' => $cache, 'mime' => $asset['mime'], 'hit' => true);
    $info = @getimagesize($source);
    if (!$info || $info[0] < 1 || $info[1] < 1 || $info[0]*$info[1] > 100000000 || image_type_to_mime_type($info[2]) !== $asset['mime']) return null;
    // GD may use more memory than the compressed file. Fail safely before an
    // allocation that cannot fit; the validator's 100 MP ceiling still applies.
    $memory = yudao_design_ini_bytes(ini_get('memory_limit'));
    if ($memory > 0 && memory_get_usage(true) + $info[0]*$info[1]*10 + 16777216 > $memory) return null;
    $decoders = array('image/jpeg' => 'imagecreatefromjpeg', 'image/png' => 'imagecreatefrompng', 'image/webp' => 'imagecreatefromwebp');
    $decoder = $decoders[$asset['mime']];
    if (!function_exists($decoder)) return null;
    $input = @$decoder($source);
    if (!$input) return null;
    if ($asset['mime'] === 'image/jpeg') {
      // Physically rotate/flip before resampling because preview metadata is
      // stripped. This also handles reflected EXIF orientations 2/4/5/7.
      if (!function_exists('exif_read_data')) return null;
      $exif = @exif_read_data($source, 'IFD0');
      $orientation = (int)($exif['Orientation'] ?? 1);
      if (in_array($orientation, array(2, 5, 7), true)) imageflip($input, IMG_FLIP_HORIZONTAL);
      elseif ($orientation === 4) imageflip($input, IMG_FLIP_VERTICAL);
      $angle = array(3 => 180, 5 => 90, 6 => -90, 7 => -90, 8 => 90)[$orientation] ?? 0;
      if ($angle) {
        $rotated = imagerotate($input, $angle, 0);
        if (!$rotated) return null;
        imagedestroy($input); $input = $rotated;
      }
    }
    $width = imagesx($input); $height = imagesy($input);
    $scale = min(1, $size / max($width, $height));
    $target_width = max(1, (int)round($width*$scale)); $target_height = max(1, (int)round($height*$scale));
    $output = imagecreatetruecolor($target_width, $target_height);
    if (!$output) return null;
    if ($asset['mime'] !== 'image/jpeg') {
      imagealphablending($output, false); imagesavealpha($output, true);
      imagefill($output, 0, 0, imagecolorallocatealpha($output, 0, 0, 0, 127));
    }
    if (!imagecopyresampled($output, $input, 0, 0, 0, 0, $target_width, $target_height, $width, $height)) return null;
    $temporary = @tempnam($directory, '.preview-');
    if (!$temporary) return null;
    $encoded = $asset['mime'] === 'image/jpeg' ? imagejpeg($output, $temporary, 85) : ($asset['mime'] === 'image/png' ? imagepng($output, $temporary, 6) : imagewebp($output, $temporary, 85));
    if (!$encoded || !filesize($temporary) || !@chmod($temporary, 0640) || !@rename($temporary, $cache)) return null;
    $temporary = null;
    return array('path' => $cache, 'mime' => $asset['mime'], 'hit' => false);
  }
  catch (Throwable $e) { error_log('Yudao preview unavailable: '.get_class($e)); return null; }
  finally {
    if ($input) imagedestroy($input);
    if ($output) imagedestroy($output);
    if ($temporary && is_file($temporary)) @unlink($temporary);
    flock($lock, LOCK_UN); fclose($lock);
  }
}
function yudao_design_serve_thumbnail($version_id, $asset_id, $size)
{
  if (!in_array((string)$size, array('400', '800'), true)) throw new YudaoDesignError('预览尺寸仅支持 400 或 800。', 400);
  list($asset, $source) = yudao_design_resolve_asset($version_id, $asset_id);
  if ($asset['kind'] !== 'image') throw new YudaoDesignError('仅图片支持缩略预览。', 400);
  session_write_close();
  $preview = yudao_design_thumbnail($asset, $source, (int)$size);
  if (!$preview) {
    // Redirect preserves original MIME, range/download behavior and EXIF. Do
    // not cache a transient inability to create a preview.
    header('Cache-Control: no-store');
    header('Location: '.get_absolute_root_url().'plugins/yudao_design/file.php?version_id='.rawurlencode($version_id).'&asset_id='.rawurlencode($asset_id), true, 302);
    return;
  }
  $etag = '"'.$asset['sha256'].'-'.$size.'-v1"';
  header('Content-Type: '.$preview['mime']); header('X-Content-Type-Options: nosniff');
  header('Cache-Control: public, max-age=86400'); header('ETag: '.$etag);
  if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) { http_response_code(304); return; }
  header('Content-Length: '.filesize($preview['path']));
  if ($_SERVER['REQUEST_METHOD'] !== 'HEAD') readfile($preview['path']);
}
