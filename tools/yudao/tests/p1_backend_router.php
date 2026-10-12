<?php
// Test-only HTTP harness. Never deploy this file or its transformed fixture.
if (PHP_SAPI !== 'cli-server' || getenv('YUDAO_P1_TEST') !== '1') { http_response_code(404); exit; }
define('PHPWG_ROOT_PATH', __DIR__.'/');
define('ACCESS_GUEST', 0);
$prefixeTable = 'p1_';
$conf = array('db_host' => 'database', 'db_user' => getenv('PIWIGO_DB_USER') ?: 'piwigo',
  'db_password' => getenv('PIWIGO_DB_PASSWORD'), 'db_base' => 'yudao_p1_isolated');
function add_event_handler(...$args) {}
function check_status($status) {}
function is_admin() { return ($_SERVER['HTTP_X_TEST_ADMIN'] ?? '') === 'yes'; }
function get_pwg_token() { return 'isolated-test-token'; }
function get_absolute_root_url() { return 'http://127.0.0.1:8788/'; }
class PwgError {
  public $code; public $message;
  function __construct($code, $message) { $this->code = $code; $this->message = $message; }
}
class TestService {
  public $methods = array();
  function addMethod($name, $handler, $params, $description, $extra = '', $options = array()) {
    $this->methods[$name] = array('handler' => $handler, 'params' => $params, 'options' => $options);
  }
}
// The fixture renames only get_project; production has no fault parameter/hook.
function yudao_design_get_project($id) {
  $GLOBALS['test_detail_reads'] = ($GLOBALS['test_detail_reads'] ?? 0) + 1;
  if (isset($GLOBALS['test_fail_on_read']) && $GLOBALS['test_detail_reads'] >= $GLOBALS['test_fail_on_read'])
    throw new RuntimeException('ISOLATED post-commit detail read fault');
  return yudao_design_test_actual_get_project($id);
}
require __DIR__.'/runtime/main.inc.php';
@mkdir('/tmp/p1-storage', 0750);
putenv('YUDAO_STORAGE_ROOT=/tmp/p1-storage');
$route = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$service = new TestService();
$arr = array($service);
yudao_design_register_methods($arr);
header('Content-Type: application/json; charset=utf-8');
try {
  if ($route === '/schema') { yudao_design_schema(); $result = array('schema' => true); }
  elseif ($route === '/methods') { $result = $service->methods; }
  elseif ($route === '/counts') {
    $result = array();
    foreach (array('projects', 'versions', 'project_settings', 'import_requests') as $name) {
      if (yudao_design_has_table($name)) $result[$name] = (int)yudao_design_query('SELECT COUNT(*) AS n FROM '.yudao_design_table($name))->get_result()->fetch_assoc()['n'];
    }
    $result['stages'] = count(glob('/tmp/p1-storage/.stage-*'));
    $result['published'] = count(glob('/tmp/p1-storage/*/manifest.json'));
  }
  elseif ($route === '/drop-addons') {
    yudao_design_query('DROP TABLE '.yudao_design_table('project_settings'));
    yudao_design_query('DROP TABLE '.yudao_design_table('import_requests'));
    $result = array('dropped' => true);
  }
  else {
    $methods = array('/import' => 'yudaoDesign.projects.import', '/fault-import' => 'yudaoDesign.projects.import',
      '/configure' => 'yudaoDesign.projects.configure', '/fault-configure' => 'yudaoDesign.projects.configure',
      '/list' => 'yudaoDesign.projects.list', '/get' => 'yudaoDesign.projects.get');
    if (!isset($methods[$route])) throw new RuntimeException('Unknown test route');
    if ($route === '/fault-import') $GLOBALS['test_fail_on_read'] = 1;
    if ($route === '/fault-configure') $GLOBALS['test_fail_on_read'] = 2;
    $method = $service->methods[$methods[$route]];
    $params = $_POST + $_GET;
    foreach ($method['params'] as $name => $options) if (!array_key_exists($name, $params) && array_key_exists('default', $options)) $params[$name] = $options['default'];
    // Piwigo's bootstrap escapes incoming string values before WS dispatch.
    foreach ($params as &$value) if (is_string($value)) $value = addslashes($value);
    unset($value);
    $result = call_user_func($method['handler'], $params, $service);
  }
  if ($result instanceof PwgError) echo json_encode(array('stat' => 'fail', 'err' => $result->code, 'message' => $result->message), JSON_UNESCAPED_UNICODE);
  else echo json_encode(array('stat' => 'ok', 'result' => $result), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
catch (Throwable $e) { http_response_code(500); echo json_encode(array('test_error' => get_class($e), 'message' => $e->getMessage()), JSON_UNESCAPED_UNICODE); }
