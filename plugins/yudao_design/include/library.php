<?php
defined('PHPWG_ROOT_PATH') or die('Access denied');

class YudaoDesignError extends RuntimeException {}

function yudao_design_id()
{
  $hex = bin2hex(random_bytes(16));
  return substr($hex, 0, 8).'-'.substr($hex, 8, 4).'-4'.substr($hex, 13, 3).'-'.dechex((hexdec($hex[16]) & 3) | 8).substr($hex, 17, 3).'-'.substr($hex, 20);
}
function yudao_design_valid_id($id)
{
  return is_string($id) && preg_match('/\A[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\z/', $id);
}
function yudao_design_ini_bytes($value)
{
  $value = trim($value);
  $n = (int)$value;
  $last = strtolower(substr($value, -1));
  return $last === 'g' ? $n*1073741824 : ($last === 'm' ? $n*1048576 : ($last === 'k' ? $n*1024 : $n));
}
function yudao_design_limits()
{
  return array('max_files' => min(64, max(1, (int)ini_get('max_file_uploads'))),
    'max_file_bytes' => min(536870912, yudao_design_ini_bytes(ini_get('upload_max_filesize'))),
    'max_total_bytes' => min(1073741824, yudao_design_ini_bytes(ini_get('post_max_size'))));
}
function yudao_design_table($name)
{
  global $prefixeTable;
  return '`'.$prefixeTable.'yudao_'.$name.'`';
}
function yudao_design_connection()
{
  global $conf;
  static $connection;
  if (!$connection) {
    $host = $conf['db_host']; $port = null; $socket = null;
    if (strpos($host, '/') === 0) { $socket = $host; $host = null; }
    elseif (strpos($host, ':') !== false) { list($host, $port) = explode(':', $host, 2); $port = (int)$port; }
    $connection = new mysqli($host, $conf['db_user'], $conf['db_password'], $conf['db_base'], $port, $socket);
    if (!$connection->set_charset('utf8mb4')) throw new RuntimeException('Database charset unavailable');
  }
  return $connection;
}
function yudao_design_query($sql, $types = '', $values = array())
{
    $mysqli = yudao_design_connection();
    $statement = $mysqli->prepare($sql);
    if (!$statement) throw new RuntimeException('Database prepare failed');
    if ($types !== '') $statement->bind_param($types, ...$values);
    if (!$statement->execute()) throw new RuntimeException('Database operation failed');
    return $statement;
}
function yudao_design_schema()
{
  $mysqli = yudao_design_connection();
  $queries = array(
    'CREATE TABLE IF NOT EXISTS '.yudao_design_table('projects').' (id CHAR(36) PRIMARY KEY, title VARCHAR(160) NOT NULL, region VARCHAR(160) NOT NULL, created_at DATETIME(6) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    'CREATE TABLE IF NOT EXISTS '.yudao_design_table('versions').' (id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL, label VARCHAR(100) NOT NULL, created_at DATETIME(6) NOT NULL, document LONGTEXT NOT NULL, UNIQUE KEY project_label(project_id,label), KEY project_created(project_id,created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    'ALTER TABLE '.yudao_design_table('projects').' MODIFY created_at DATETIME(6) NOT NULL',
    'ALTER TABLE '.yudao_design_table('versions').' MODIFY created_at DATETIME(6) NOT NULL',
  );
  foreach ($queries as $sql) { if (!$mysqli->query($sql)) throw new RuntimeException('Schema unavailable'); }
}
function yudao_design_storage()
{
  global $conf;
  $root = getenv('YUDAO_STORAGE_ROOT') ?: ($conf['yudao_design_storage_root'] ?? '');
  $real = $root !== '' ? realpath($root) : false;
  $web = realpath(PHPWG_ROOT_PATH);
  if (!$real || !$web || $real === $web || strpos($real, $web.DIRECTORY_SEPARATOR) === 0)
    throw new YudaoDesignError('请先配置网站目录之外的 YUDAO_STORAGE_ROOT 资料目录。', 503);
  return $real;
}
function yudao_design_public_project($project)
{
  foreach ($project['versions'] as &$version)
  {
    foreach ($version['assets'] as &$asset)
    {
      $asset['url'] = get_absolute_root_url().'plugins/yudao_design/file.php?version_id='.rawurlencode($version['id']).'&asset_id='.rawurlencode($asset['id']);
      unset($asset['file'], $asset['mime']);
    }
    unset($asset);
  }
  unset($version);
  return $project;
}
function yudao_design_list_projects()
{
  $projects = array();
  $rows = yudao_design_query('SELECT * FROM '.yudao_design_table('projects').' ORDER BY created_at DESC, id')->get_result();
  while ($row = $rows->fetch_assoc()) { $row['versions'] = array(); $projects[$row['id']] = $row; }
  $rows = yudao_design_query('SELECT project_id, document FROM '.yudao_design_table('versions').' ORDER BY created_at DESC, id')->get_result();
  while ($row = $rows->fetch_assoc())
    if (isset($projects[$row['project_id']])) $projects[$row['project_id']]['versions'][] = json_decode($row['document'], true, 512, JSON_THROW_ON_ERROR);
  return array_map('yudao_design_public_project', array_values($projects));
}
function yudao_design_get_project($id)
{
  if (!yudao_design_valid_id($id)) throw new YudaoDesignError('项目编号无效。', 400);
  $row = yudao_design_query('SELECT * FROM '.yudao_design_table('projects').' WHERE id=?', 's', array($id))->get_result()->fetch_assoc();
  if (!$row) throw new YudaoDesignError('没有找到该项目。', 404);
  $row['versions'] = array();
  $versions = yudao_design_query('SELECT document FROM '.yudao_design_table('versions').' WHERE project_id=? ORDER BY created_at DESC, id', 's', array($id))->get_result();
  while ($version = $versions->fetch_assoc()) $row['versions'][] = json_decode($version['document'], true, 512, JSON_THROW_ON_ERROR);
  return yudao_design_public_project($row);
}
function yudao_design_text($value, $max, $required = false)
{
  if (!is_string($value) || !mb_check_encoding($value, 'UTF-8')) throw new YudaoDesignError('项目信息格式无效。', 400);
  $value = trim($value);
  if (($required && $value === '') || mb_strlen($value, 'UTF-8') > $max || strpos($value, "\0") !== false)
    throw new YudaoDesignError('请检查项目名称、版本或说明的长度。', 400);
  return $value;
}
function yudao_design_validate_file($path, $name)
{
  $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
  $head = file_get_contents($path, false, null, 0, 65536);
  $images = array('jpg' => IMAGETYPE_JPEG, 'jpeg' => IMAGETYPE_JPEG, 'png' => IMAGETYPE_PNG, 'webp' => IMAGETYPE_WEBP);
  if (isset($images[$ext]))
  {
    $info = @getimagesize($path);
    if (!$info || $info[2] !== $images[$ext] || $info[0] * $info[1] > 100000000)
      throw new YudaoDesignError($name.' 不是可读取的图片。', 400);
    return array('image', image_type_to_mime_type($info[2]));
  }
  if ($ext === 'pdf' && substr($head, 0, 5) === '%PDF-') return array('pdf', 'application/pdf');
  if (in_array($ext, array('csv', 'txt'), true))
  {
    if (filesize($path) > 16777216) throw new YudaoDesignError($name.' 文本文件不能超过 16 MB。', 400);
    $text = file_get_contents($path);
    if ($text === false || !mb_check_encoding($text, 'UTF-8') || strpos($text, "\0") !== false)
      throw new YudaoDesignError($name.' 请保存为 UTF-8 文本格式。', 400);
    return array('document', $ext === 'csv' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8');
  }
  if ($ext === 'dwg' && preg_match('/\AAC10[0-9]{2}/', $head)) return array('cad', 'application/octet-stream');
  if ($ext === 'dxf' && (strpos($head, "AutoCAD Binary DXF\r\n\x1a\0") === 0 || preg_match('/(?:\A|\R)\s*0\s*\R\s*SECTION\s*\R/', $head)))
    return array('cad', 'application/octet-stream');
  if ($ext === 'glb')
  {
    yudao_design_validate_glb($path, $name);
    return array('model', 'model/gltf-binary');
  }
  throw new YudaoDesignError($name.' 格式不支持或内容无效；支持 JPG、PNG、WebP、GLB、PDF、DWG、DXF、CSV、TXT。', 400);
}
function yudao_design_validate_glb($path, $name)
{
  $f = fopen($path, 'rb');
  try {
    $header = fread($f, 12);
    if (strlen($header) !== 12) throw new RuntimeException();
    $h = unpack('a4magic/Vversion/Vlength', $header);
    if ($h['magic'] !== 'glTF' || $h['version'] !== 2 || $h['length'] !== filesize($path)) throw new RuntimeException();
    $chunk = fread($f, 8);
    if (strlen($chunk) !== 8) throw new RuntimeException();
    $c = unpack('Vlength/Vtype', $chunk);
    if ($c['type'] !== 0x4e4f534a || $c['length'] < 4 || $c['length'] > 16777216 || $c['length'] % 4 !== 0 || $c['length'] + 20 > $h['length']) throw new RuntimeException();
    $json = json_decode(fread($f, $c['length']), true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($json) || ($json['asset']['version'] ?? '') !== '2.0' || empty($json['meshes'])) throw new RuntimeException();
    foreach (array_merge($json['buffers'] ?? array(), $json['images'] ?? array()) as $resource)
      if (isset($resource['uri']) && strpos($resource['uri'], 'data:') !== 0)
        throw new YudaoDesignError($name.' 需要外部贴图或文件，请导出为贴图内嵌的 GLB 再上传。', 400);
    $bin_length = 0;
    while (ftell($f) < $h['length']) {
      $chunk = fread($f, 8);
      if (strlen($chunk) !== 8) throw new RuntimeException();
      $c = unpack('Vlength/Vtype', $chunk);
      if ($c['length'] % 4 || ftell($f) + $c['length'] > $h['length']) throw new RuntimeException();
      if ($c['type'] === 0x004e4942) $bin_length += $c['length'];
      fseek($f, $c['length'], SEEK_CUR);
    }
    foreach ($json['buffers'] ?? array() as $buffer)
      if (!isset($buffer['uri']) && ($buffer['byteLength'] ?? 0) > $bin_length) throw new RuntimeException();
  }
  catch (YudaoDesignError $e) { throw $e; }
  catch (Throwable $e) { throw new YudaoDesignError($name.' 不是完整有效的 GLB 2.0 模型。', 400); }
  finally { if (is_resource($f)) fclose($f); }
}
function yudao_design_remove_directory($path)
{
  if (!is_dir($path) || is_link($path)) return;
  foreach (new DirectoryIterator($path) as $entry)
    if (!$entry->isDot() && $entry->isFile()) unlink($entry->getPathname());
  rmdir($path);
}
function yudao_design_import($params, $files)
{
  $mysqli = yudao_design_connection();
  $title = yudao_design_text($params['title'], 160, true);
  $region = yudao_design_text($params['region'], 160);
  $label = yudao_design_text($params['version'], 100, true);
  $description = yudao_design_text($params['description'], 10000);
  $project_id = $params['project_id'] ?: yudao_design_id();
  $new_project = $params['project_id'] === '';
  if (!yudao_design_valid_id($project_id)) throw new YudaoDesignError('项目编号无效。', 400);
  try { $manifest = json_decode($params['manifest'], true, 512, JSON_THROW_ON_ERROR); }
  catch (Throwable $e) { throw new YudaoDesignError('文件分类信息无效。', 400); }
  if (!is_array($manifest) || count($manifest) > 64) throw new YudaoDesignError('文件分类信息无效。', 400);
  $roles = array();
  foreach ($manifest as $entry) {
    if (!is_array($entry) || !isset($entry['name'], $entry['role']) || !is_string($entry['name']) || !in_array($entry['role'], array('source', 'effect', 'document'), true))
      throw new YudaoDesignError('文件分类信息无效。', 400);
    $roles[$entry['name']] = $entry['role'];
  }
  $limits = yudao_design_limits();
  if (!isset($files['name']) || !is_array($files['name']) || count($files['name']) < 1 || count($files['name']) > $limits['max_files'])
    throw new YudaoDesignError('请选择文件，单次最多上传 '.$limits['max_files'].' 个。', 400);
  if (count($manifest) > 0 && (count($roles) !== count($files['name']) || array_diff(array_keys($roles), $files['name'])))
    throw new YudaoDesignError('收到的文件不完整或分类信息不匹配，请减少文件后重试。', 400);
  $assets = array(); $total = 0; $names = array();
  foreach ($files['name'] as $i => $name)
  {
    if (!is_string($name) || basename(str_replace('\\', '/', $name)) !== $name || preg_match('/[\x00-\x1f]/', $name) || !mb_check_encoding($name, 'UTF-8') || strlen($name) > 255 || isset($names[$name]))
      throw new YudaoDesignError('文件名无效或存在重名，请重命名后上传。', 400);
    $names[$name] = true;
    $tmp = $files['tmp_name'][$i] ?? '';
    if (($files['error'][$i] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($tmp))
      throw new YudaoDesignError($name.' 上传未完成，请检查文件大小后重试。', 400);
    $bytes = filesize($tmp); $total += $bytes;
    if (!$bytes || $bytes > $limits['max_file_bytes'] || $total > $limits['max_total_bytes'])
      throw new YudaoDesignError('文件超过上传容量限制，请减少文件大小。', 413);
    list($kind, $mime) = yudao_design_validate_file($tmp, $name);
    $id = yudao_design_id();
    $assets[] = array('id' => $id, 'name' => $name, 'kind' => $kind,
      'role' => $kind === 'image' ? (($roles[$name] ?? '') === 'source' ? 'source' : 'effect') : 'document',
      'file' => $id.'.'.strtolower(pathinfo($name, PATHINFO_EXTENSION)), 'mime' => $mime,
      'bytes' => $bytes, 'sha256' => hash_file('sha256', $tmp), 'temporary' => $tmp);
  }
  $root = yudao_design_storage();
  $id = yudao_design_id();
  $stage = $root.'/.stage-'.$id; $final = $root.'/'.$id;
  if (!@mkdir($stage, 0750)) throw new YudaoDesignError('资料目录无法写入，请检查存储空间。', 503);
  $lock = null; $committed = false; $started = false;
  try {
    foreach ($assets as &$asset) {
      if (!move_uploaded_file($asset['temporary'], $stage.'/'.$asset['file'])) throw new RuntimeException('File move failed');
      unset($asset['temporary']);
    }
    unset($asset);
    $created = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $version = array('id' => $id, 'label' => $label, 'description' => $description, 'created_at' => $created->format('Y-m-d\TH:i:s.u\Z'), 'assets' => $assets);
    $document = json_encode($version, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    if (file_put_contents($stage.'/manifest.json', $document, LOCK_EX) === false) throw new RuntimeException('Manifest write failed');
    $lock = fopen($root.'/.publish.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Publish lock unavailable');
    $mysqli->begin_transaction(); $started = true;
    $now = $created->format('Y-m-d H:i:s.u');
    if ($new_project) {
      yudao_design_query('INSERT INTO '.yudao_design_table('projects').' (id,title,region,created_at) VALUES(?,?,?,?)', 'ssss', array($project_id, $title, $region, $now));
    } else {
      if (!yudao_design_query('SELECT id FROM '.yudao_design_table('projects').' WHERE id=? FOR UPDATE', 's', array($project_id))->get_result()->fetch_assoc())
        throw new YudaoDesignError('项目不存在，请刷新后重新选择。', 404);
    }
    if (yudao_design_query('SELECT id FROM '.yudao_design_table('versions').' WHERE project_id=? AND label=?', 'ss', array($project_id, $label))->get_result()->fetch_assoc())
      throw new YudaoDesignError('该版本已存在，请使用新的版本名称；旧资料会保留。', 409);
    if (!rename($stage, $final)) throw new RuntimeException('Publication move failed');
    yudao_design_query('INSERT INTO '.yudao_design_table('versions').' (id,project_id,label,created_at,document) VALUES(?,?,?,?,?)', 'sssss', array($id, $project_id, $label, $now, $document));
    if (!$mysqli->commit()) throw new RuntimeException('Publication commit failed');
    $committed = true;
  }
  finally {
    if (!$committed) {
      if ($started) $mysqli->rollback();
      yudao_design_remove_directory($stage); yudao_design_remove_directory($final);
    }
    if (is_resource($lock)) { flock($lock, LOCK_UN); fclose($lock); }
  }
  return yudao_design_get_project($project_id);
}
