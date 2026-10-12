#!/usr/bin/env python3
"""Real MariaDB + HTTP upload checks in a disposable local test container/database.

Uses only yudao_p1_isolated in Docker context colima-yudao-piwigo. The production
plugin is copied, never modified for faults. Run from the repository directory.
"""
import base64
import concurrent.futures
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[3]
DOCKER = ['docker', '--context', 'colima-yudao-piwigo']
CONTAINER = 'yudao-p1-isolated-http'
BASE = 'http://127.0.0.1:8788'
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=')
checks = []


def command(args, check=True):
    return subprocess.run(DOCKER + args, check=check, capture_output=True, text=True)


def db(sql):
    return command(['exec', 'yudao-piwigo-database-1', 'sh', '-c',
                    'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -e "$1"', 'test-db', sql])


def require(condition, label):
    if not condition:
        raise AssertionError(label)
    checks.append(label)


def request(route, fields=None, files=None, admin=True):
    headers = {'X-Test-Admin': 'yes'} if admin else {}
    if fields is None:
        payload = None
    elif files is None:
        payload = urllib.parse.urlencode(fields).encode()
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
    else:
        boundary = 'P1Test' + uuid.uuid4().hex
        parts = []
        for key, value in fields.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
        for name, content in files:
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="files[]"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode() + content + b'\r\n')
        parts.append(f'--{boundary}--\r\n'.encode())
        payload = b''.join(parts)
        headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary
    with urllib.request.urlopen(urllib.request.Request(BASE + route, payload, headers), timeout=40) as response:
        return json.load(response)


def ok(value):
    if value.get('stat') != 'ok':
        raise AssertionError(value)
    return value['result']


def upload(project='', label='R1', request_id=None, route='/import', files=None):
    fields = dict(title='隔离测试项目', region='P1', version=label, description='真实HTTP上传',
                  project_id=project, manifest='[]', pwg_token='isolated-test-token')
    if request_id is not None:
        fields['request_id'] = request_id
    return request(route, fields, files if files is not None else [('封面.png', PNG)])


def configure(project, **changes):
    return request('/configure', dict(project_id=project, pwg_token='isolated-test-token', **changes))


def run_checks():
    ok(request('/schema'))
    methods = ok(request('/methods'))
    require(methods['yudaoDesign.projects.configure']['options'] == {'admin_only': True, 'post_only': True}, 'configure WS requires admin and POST')
    require(methods['yudaoDesign.projects.configure']['params']['cover_asset_id']['default'] is None, 'configure omitted fields preserve settings')
    req = str(uuid.uuid4())
    first = ok(upload(request_id=req))
    pid, vid = first['project_id'], first['version_id']
    require(first['saved'] and first['project']['id'] == pid and first['warning'] is None, 'normal import includes saved receipt and compatible project')
    require(first['project']['current_version_id'] == vid, 'new project persists first version as current')
    cover = first['project']['versions'][0]['assets'][0]['id']
    replay = ok(upload(request_id=req))
    require(replay == first, 'identical request UUID returns original complete receipt')
    require(ok(request('/counts'))['versions'] == 1, 'retry does not create duplicate project or version')
    require(upload(label='DIFFERENT', request_id=req)['err'] == 409, 'request UUID cannot be reused for changed metadata')
    require(upload(request_id=req, files=[('封面.png', PNG + b'changed')])['err'] == 409, 'request UUID cannot be reused for changed file content')
    require(upload(request_id='invalid')['err'] == 400, 'invalid request UUID rejected')

    model = [dict(key='terrace', label='檐下露台', version_id=vid,
                  url='plugins/yudao_design/viewer.php/model/covered-terrace-r26/R26檐下露台及日式外观.html')]
    configured = ok(configure(pid, current_version_id=vid, cover_asset_id=cover, interactive_models=json.dumps(model, ensure_ascii=False)))
    require(configured['saved'] and configured['project']['interactive_models'] == model and configured['project']['cover_asset_id'] == cover, 'valid current version, cover, Unicode relative viewer URL saved')
    patched = ok(configure(pid, interactive_models='[]'))['project']
    require(patched['current_version_id'] == vid and patched['cover_asset_id'] == cover and patched['interactive_models'] == [], 'PATCH omission preserves current version and cover')
    second = ok(upload(pid, 'HISTORY', str(uuid.uuid4())))
    require(second['project']['current_version_id'] == vid and second['project']['cover_asset_id'] == cover, 'later import does not overwrite saved current or cover')
    outsider = ok(upload(label='OUTSIDE', request_id=str(uuid.uuid4())))
    other_vid = outsider['version_id']
    other_asset = outsider['project']['versions'][0]['assets'][0]['id']
    require(configure(pid, current_version_id=other_vid)['err'] == 400, 'cross-project current version rejected')
    require(configure(pid, cover_asset_id=other_asset)['err'] == 400, 'cross-project cover asset rejected')
    doc = ok(upload(pid, 'TEXT', str(uuid.uuid4()), files=[('文本.txt', b'UTF8 text')]))
    text_asset = doc['project']['versions'][0]['assets'][0]['id']
    require(configure(pid, cover_asset_id=text_asset)['err'] == 400, 'non-image cover rejected')
    bad_model = [dict(model[0], version_id=other_vid)]
    require(configure(pid, interactive_models=json.dumps(bad_model))['err'] == 400, 'cross-project interactive model version rejected')
    bad_urls = ['https://example.com/model.html', '//example.com/model.html', '/plugins/yudao_design/viewer.php/model/a/b.html',
                'plugins/yudao_design/viewer.php/model/a/../b.html', 'plugins/yudao_design/viewer.php/model/a/%2e%2e/b.html',
                'plugins/yudao_design/viewer.php/model/a/%252e%252e/b.html', 'plugins/yudao_design/viewer.php/model/a/%2fb.html',
                'plugins/yudao_design/viewer.php/model/a/b.html?x=1', 'plugins/yudao_design/viewer.php/model/a/b.html#x',
                'plugins/yudao_design/viewer.php/model/a/b\\c.html']
    for url in bad_urls:
        require(configure(pid, interactive_models=json.dumps([dict(model[0], url=url)]))['err'] == 400, 'unsafe model URL rejected: ' + url)
    require(configure(pid, interactive_models=json.dumps([model[0], model[0]]))['err'] == 400, 'duplicate model keys rejected')
    require(configure(pid, interactive_models='{}')['err'] == 400, 'model JSON object rejected')
    auth_fields = dict(project_id=pid, pwg_token='isolated-test-token')
    require(request('/configure', auth_fields, admin=False)['err'] == 403, 'non-admin cannot configure')
    require(request('/configure', dict(auth_fields, pwg_token='wrong'))['err'] == 403, 'wrong pwg_token cannot configure')
    require(request('/import', dict(title='x', version='x', pwg_token='wrong'), [('x.txt', b'x')])['err'] == 403, 'wrong pwg_token cannot import')

    fault_req = str(uuid.uuid4())
    fault = ok(upload(pid, 'POSTCOMMIT', fault_req, '/fault-import'))
    require(fault['saved'] and fault['project'] is None and bool(fault['warning']), 'post-commit detail fault still returns saved=true and IDs with warning')
    require(ok(upload(pid, 'POSTCOMMIT', fault_req)) == fault, 'post-commit fault retry returns original saved receipt without duplicate')
    details = ok(request('/get?project_id=' + pid))['project']
    require(any(v['id'] == fault['version_id'] for v in details['versions']), 'post-commit fault version remains persisted and readable')
    fault_config = ok(request('/fault-configure', dict(project_id=pid, cover_asset_id='', pwg_token='isolated-test-token')))
    require(fault_config['saved'] and fault_config['project'] is None and bool(fault_config['warning']), 'post-commit configure detail fault still reports saved')
    require(ok(request('/get?project_id=' + pid))['project']['cover_asset_id'] is None, 'configure fault setting really committed')

    fail_req = str(uuid.uuid4())
    before = ok(request('/counts'))
    require(upload(pid, 'RETRYFAIL', fail_req, files=[('retry.txt', b'bad\x00text')])['err'] == 400, 'invalid file fails before publication')
    require(ok(request('/counts')) == before, 'failed upload leaves no request, version or staged files')
    require(ok(upload(pid, 'RETRYFAIL', fail_req, files=[('retry.txt', b'valid retry')]))['saved'], 'same UUID after failed attempt can continue successfully')
    duplicate_req = str(uuid.uuid4())
    before = ok(request('/counts'))
    require(upload(pid, 'R1', duplicate_req)['err'] == 409, 'duplicate label rejects after staging')
    require(ok(request('/counts')) == before, 'transaction failure rolls back records and cleans staged files')
    require(ok(upload(pid, 'AFTERROLLBACK', duplicate_req))['saved'], 'same UUID after transaction rollback can continue')

    concurrent_req = str(uuid.uuid4())
    before = ok(request('/counts'))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        concurrent_receipts = list(pool.map(lambda _: ok(upload(label='CONCURRENT', request_id=concurrent_req)), range(4)))
    after = ok(request('/counts'))
    require(all(r == concurrent_receipts[0] for r in concurrent_receipts), 'four concurrent same UUID uploads receive identical receipt')
    require(after['projects'] == before['projects'] + 1 and after['versions'] == before['versions'] + 1 and after['import_requests'] == before['import_requests'] + 1, 'concurrent upload commits exactly one project/version/request')
    require(after['stages'] == 0 and after['published'] == after['versions'], 'published file count matches committed versions and no stages remain')
    listing = ok(request('/list'))['projects']
    require(all({'current_version_id', 'cover_asset_id', 'interactive_models'} <= p.keys() for p in listing), 'all public project list responses expose new fields')

    ok(request('/drop-addons'))
    legacy = ok(request('/get?project_id=' + pid))['project']
    require(legacy['current_version_id'] == legacy['versions'][0]['id'] and legacy['cover_asset_id'] is None and legacy['interactive_models'] == [], 'missing settings table preserves legacy latest and public field defaults')
    require(configure(pid, cover_asset_id='')['err'] == 503, 'configure requires explicit migration when table missing')
    require(upload(pid, 'MIGRATE', str(uuid.uuid4()))['err'] == 503, 'request UUID upload requires migration rather than silently losing idempotency')
    old = ok(upload(pid, 'LEGACY-NOREQUEST'))
    require(old['saved'], 'legacy import without request UUID works before addon migration')
    old_latest = old['version_id']
    ok(request('/schema'))
    frozen = ok(upload(pid, 'HISTORIC-AFTER-MIGRATION', str(uuid.uuid4())))
    require(frozen['project']['current_version_id'] == old_latest, 'first import after migration freezes existing project pre-upload latest')
    cleared = ok(configure(pid, current_version_id=''))['project']
    require(cleared['current_version_id'] == cleared['versions'][0]['id'], 'explicit empty current version restores legacy latest fallback')
    return ok(request('/counts'))


def main():
    output = Path(os.environ.get('YUDAO_P1_TEST_OUTPUT', tempfile.gettempdir() + '/yudao-p1-backend-results.json'))
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='yudao-p1-http-') as scratch:
        fixture = Path(scratch) / 'http'
        (fixture / 'runtime/include').mkdir(parents=True)
        source = (ROOT / 'plugins/yudao_design/include/library.php').read_text()
        source = source.replace('function yudao_design_get_project($id)', 'function yudao_design_test_actual_get_project($id)')
        (fixture / 'runtime/include/library.php').write_text(source)
        shutil.copy(ROOT / 'plugins/yudao_design/main.inc.php', fixture / 'runtime/main.inc.php')
        shutil.copy(Path(__file__).with_name('p1_backend_router.php'), fixture / 'router.php')
        command(['rm', '-f', CONTAINER], check=False)
        db("DROP DATABASE IF EXISTS yudao_p1_isolated; CREATE DATABASE yudao_p1_isolated CHARACTER SET utf8mb4; GRANT ALL ON yudao_p1_isolated.* TO 'piwigo'@'%';")
        started = time.time()
        try:
            command(['create', '--name', CONTAINER, '--network', 'yudao-piwigo_default',
                     '--env-file', str(ROOT.parent / 'piwigo-runtime-evidence/yudao-piwigo.env'),
                     '-e', 'PHP_CLI_SERVER_WORKERS=4', '-e', 'YUDAO_P1_TEST=1', '-p', '127.0.0.1:8788:8080', '--entrypoint', 'php',
                     'yudao-piwigo-piwigo', '-S', '0.0.0.0:8080', '-t', '/tmp/p1-http', '/tmp/p1-http/router.php'])
            command(['cp', str(fixture), CONTAINER + ':/tmp/p1-http'])
            command(['start', CONTAINER])
            for _ in range(50):
                try:
                    ok(request('/methods'))
                    break
                except Exception:
                    time.sleep(0.1)
            lint = []
            for path in ('runtime/include/library.php', 'runtime/main.inc.php', 'router.php'):
                lint.append(command(['exec', CONTAINER, 'php', '-l', '/tmp/p1-http/' + path]).stdout.strip())
            counts = run_checks()
            result = dict(passed=True, checks=len(checks), assertions=checks, counts=counts,
                          lint=lint, elapsed_seconds=round(time.time() - started, 2),
                          environment='isolated MariaDB yudao_p1_isolated + PHP 8.3 HTTP 4 workers; no production writes')
            output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
            print(json.dumps(dict(passed=True, checks=len(checks), counts=counts, evidence=str(output)), ensure_ascii=False))
        except Exception as error:
            output.write_text(json.dumps(dict(passed=False, checks=len(checks), assertions=checks, error=str(error)), ensure_ascii=False, indent=2) + '\n')
            print('TEST FAILED:', error)
            raise
        finally:
            output.with_suffix('.http.log').write_text(command(['logs', CONTAINER], check=False).stderr)
            command(['rm', '-f', CONTAINER], check=False)
            db('DROP DATABASE IF EXISTS yudao_p1_isolated;')


if __name__ == '__main__':
    main()
