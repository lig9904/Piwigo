<?php
// Disposable HTTP harness. Never deploy this router or bootstrap.
if (PHP_SAPI !== 'cli-server' || getenv('YUDAO_P2_TEST') !== '1') { http_response_code(404); exit; }
$route = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (in_array($route, array('/plugins/yudao_design/thumbnail.php', '/plugins/yudao_design/file.php'), true)) {
  chdir(__DIR__.'/plugins/yudao_design');
  require basename($route);
  return;
}
define('PHPWG_ROOT_PATH', __DIR__.'/');
require __DIR__.'/include/common.inc.php';
$service = new TestService(); $arr = array($service); yudao_design_register_methods($arr);
header('Content-Type: application/json; charset=utf-8');
try {
  if ($route === '/schema') { yudao_design_schema(); $result = array('schema' => true); }
  elseif ($route === '/methods') { $result = $service->methods; }
  elseif ($route === '/digest') {
    $rows = yudao_design_query('SELECT document FROM '.yudao_design_table('versions').' ORDER BY id')->get_result();
    $documents = ''; while ($row = $rows->fetch_assoc()) $documents .= $row['document'];
    $result = array('documents_sha256' => hash('sha256', $documents));
  }
  elseif ($route === '/budget') {
    try { yudao_design_validate_upload_bytes($_GET['name'], (int)$_GET['bytes'], (int)$_GET['total']); $result = array('accepted' => true); }
    catch (YudaoDesignError $e) { $result = new PwgError($e->getCode(), $e->getMessage()); }
  }
  elseif ($route === '/counts') {
    $result = array('versions' => (int)yudao_design_query('SELECT COUNT(*) AS n FROM '.yudao_design_table('versions'))->get_result()->fetch_assoc()['n'],
      'cache_files' => count(array_merge(glob('/tmp/p2-storage/.previews/*-v1.jpg'), glob('/tmp/p2-storage/.previews/*-v1.png'), glob('/tmp/p2-storage/.previews/*-v1.webp'))));
  }
  else {
    $methods = array('/import' => 'yudaoDesign.projects.import', '/list' => 'yudaoDesign.projects.list', '/get' => 'yudaoDesign.projects.get', '/annotate' => 'yudaoDesign.projects.annotate', '/fault-annotate' => 'yudaoDesign.projects.annotate');
    if (!isset($methods[$route])) throw new RuntimeException('Unknown route');
    $method = $service->methods[$methods[$route]]; $params = $_POST + $_GET;
    foreach ($method['params'] as $name => $options) if (!array_key_exists($name, $params) && array_key_exists('default', $options)) $params[$name] = $options['default'];
    foreach ($params as &$value) if (is_string($value)) $value = addslashes($value);
    unset($value);
    if ($route === '/fault-annotate') $GLOBALS['p2_fail_detail'] = true;
    $result = call_user_func($method['handler'], $params, $service);
  }
  echo json_encode($result instanceof PwgError ? array('stat'=>'fail','err'=>$result->code,'message'=>$result->message) : array('stat'=>'ok','result'=>$result), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
catch (Throwable $e) { http_response_code(500); echo json_encode(array('test_error'=>get_class($e),'message'=>$e->getMessage()), JSON_UNESCAPED_UNICODE); }
