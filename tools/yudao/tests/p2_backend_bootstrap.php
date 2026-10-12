<?php
if (!in_array(PHP_SAPI, array('cli-server', 'cli'), true) || getenv('YUDAO_P2_TEST') !== '1') { http_response_code(404); exit; }
if (!defined('ACCESS_GUEST')) define('ACCESS_GUEST', 0);
$prefixeTable = 'p2_';
$conf = array('db_host'=>'database','db_user'=>getenv('PIWIGO_DB_USER') ?: 'piwigo','db_password'=>getenv('PIWIGO_DB_PASSWORD'),'db_base'=>'yudao_p2_isolated');
$conf['webmaster_id'] = 1;
function build_user($id, $cache = true) { return array('id'=>$id, 'status'=>'webmaster'); }
$pwg_loaded_plugins = array('yudao_design'=>true);
function add_event_handler(...$args) {}
function check_status($status) {}
function is_admin() { return ($_SERVER['HTTP_X_TEST_ADMIN'] ?? '') === 'yes'; }
function get_pwg_token() { return 'isolated-test-token'; }
function get_absolute_root_url() { return 'http://127.0.0.1:8789/'; }
class PwgError { public $code; public $message; function __construct($code,$message) { $this->code=$code; $this->message=$message; } }
class TestService { public $methods=array(); function addMethod($name,$handler,$params,$description,$extra='',$options=array()) { $this->methods[$name]=array('handler'=>$handler,'params'=>$params,'options'=>$options); } }
putenv('YUDAO_STORAGE_ROOT=/tmp/p2-storage');
function yudao_design_get_project($id) {
  if (!empty($GLOBALS['p2_fail_detail'])) throw new RuntimeException('ISOLATED postcommit caption read failure');
  return yudao_design_p2_actual_get_project($id);
}
require __DIR__.'/../plugins/yudao_design/main.inc.php';
