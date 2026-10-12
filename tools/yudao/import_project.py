#!/usr/bin/env python3
"""Import a project version with the same multipart endpoint as the web form.

Credentials are read from environment or a prompt, never command-line arguments.
Use --manifest for a JSON object with title, region, version, description, optional
project_id, and files: [{path, role: source|effect|document}]. Relative paths are
resolved against the manifest's directory. No third-party Python dependencies.
"""
import argparse
import getpass
import http.cookiejar
import json
import mimetypes
import os
from pathlib import Path
import tempfile
import urllib.parse
import urllib.request
import uuid


def request_json(opener, url, data=None):
    request = urllib.request.Request(url, data=data)
    if data is not None:
        request.add_header('Content-Type', 'application/x-www-form-urlencoded')
    with opener.open(request, timeout=600) as response:
        result = json.load(response)
    if result.get('stat') != 'ok':
        raise RuntimeError(result.get('message', '请求失败'))
    return result['result']


def import_version(base_url, username, password, manifest_path):
    manifest_path = Path(manifest_path).resolve()
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    parsed = urllib.parse.urlparse(base_url)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc:
        raise ValueError('请指定完整的 Piwigo 地址')
    ws = base_url.rstrip('/') + '/ws.php?format=json'
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    request_json(opener, ws, urllib.parse.urlencode({'method': 'pwg.session.login', 'username': username, 'password': password}).encode())
    status = request_json(opener, ws + '&method=pwg.session.getStatus')
    boundary = 'YudaoUpload' + uuid.uuid4().hex
    metadata = []
    fields = {key: manifest.get(key, '') for key in ('title', 'region', 'version', 'description', 'project_id')}
    fields['method'] = 'yudaoDesign.projects.import'
    fields['pwg_token'] = status['pwg_token']
    files = []
    for entry in manifest['files']:
        path = (manifest_path.parent / entry['path']).resolve()
        if not path.is_file():
            raise ValueError(f'文件不存在：{path}')
        if '\n' in path.name or '\r' in path.name or '"' in path.name:
            raise ValueError('文件名不能包含引号或换行')
        files.append(path)
        metadata.append({'name': path.name, 'role': entry.get('role', 'document')})
    fields['manifest'] = json.dumps(metadata, ensure_ascii=False)
    with tempfile.TemporaryFile() as body:
        def write(text):
            body.write(text.encode('utf-8'))
        for name, value in fields.items():
            write(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n')
        for path in files:
            mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
            write(f'--{boundary}\r\nContent-Disposition: form-data; name="files[]"; filename="{path.name}"\r\nContent-Type: {mime}\r\n\r\n')
            with path.open('rb') as source:
                while chunk := source.read(1024 * 1024):
                    body.write(chunk)
            write('\r\n')
        write(f'--{boundary}--\r\n')
        size = body.tell()
        body.seek(0)
        request = urllib.request.Request(ws + '&method=yudaoDesign.projects.import', data=body, method='POST')
        request.add_header('Content-Type', 'multipart/form-data; boundary=' + boundary)
        request.add_header('Content-Length', str(size))
        with opener.open(request, timeout=900) as response:
            result = json.load(response)
    if result.get('stat') != 'ok':
        raise RuntimeError(result.get('message', '保存失败'))
    project = result['result']['project']
    return {'project_id': project['id'], 'title': project['title'], 'versions': len(project['versions']),
            'page_url': base_url.rstrip('/') + '/plugins/yudao_design/project.php?project=' + project['id']}


def main():
    parser = argparse.ArgumentParser(description='批量导入渔岛设计项目版本')
    parser.add_argument('--url', required=True)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--output')
    args = parser.parse_args()
    username = os.environ.get('PIWIGO_USERNAME') or input('管理员用户名：')
    password = os.environ.get('PIWIGO_PASSWORD') or getpass.getpass('管理员密码：')
    result = import_version(args.url, username, password, args.manifest)
    output = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        Path(args.output).write_text(output, encoding='utf-8')
    print(output, end='')


if __name__ == '__main__':
    main()
