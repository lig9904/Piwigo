#!/usr/bin/env python3
"""P2 real HTTP/GD/MariaDB tests; isolated DB/container/8789, no mounted data.
Requires Pillow. Logs/results/preview evidence are retained in the output folder.
"""
import concurrent.futures
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
DOCKER = ['docker', '--context', 'colima-yudao-piwigo']
CONTAINER = 'yudao-p2-isolated-http'
BASE = 'http://127.0.0.1:8789'
checks = []
OUTPUT = Path(os.environ.get('YUDAO_P2_TEST_OUTPUT', str(ROOT.parent / 'piwigo-p2-evidence/backend/results.json')))


def command(args, check=True):
    return subprocess.run(DOCKER + args, check=check, capture_output=True, text=True)


def db(sql):
    return command(['exec', 'yudao-piwigo-database-1', 'sh', '-c',
                    'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -e "$1"', 'p2-test-db', sql])


def require(condition, label):
    if not condition:
        raise AssertionError(label)
    checks.append(label)


def multipart(fields, files):
    boundary = 'P2Test' + uuid.uuid4().hex
    parts = []
    for key, value in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
    for name, content in files:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="files[]"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode() + content + b'\r\n')
    parts.append(f'--{boundary}--\r\n'.encode())
    return b''.join(parts), 'multipart/form-data; boundary=' + boundary


def fetch(url, data=None, headers=None, method=None):
    req = urllib.request.Request(url if url.startswith('http') else BASE + url, data, headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=90) as res:
            return res.status, dict(res.headers), res.read(), res.url
    except urllib.error.HTTPError as res:
        return res.code, dict(res.headers), res.read(), res.url


def request(route, fields=None, files=None, admin=True):
    headers = {'X-Test-Admin': 'yes'} if admin else {}
    if fields is None:
        data = None
    elif files is None:
        data = urllib.parse.urlencode(fields).encode()
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
    else:
        data, headers['Content-Type'] = multipart(fields, files)
    status, _, body, _ = fetch(route, data, headers)
    if status != 200:
        raise AssertionError((status, body[:400]))
    return json.loads(body)


def ok(value):
    if value.get('stat') != 'ok':
        raise AssertionError(value)
    return value['result']


def upload(files, description='真实HTTP上传', request_id=None):
    fields = dict(title='P2隔离测试', region='测试', version=str(uuid.uuid4()), description=description,
                  project_id='', manifest='[]', pwg_token='isolated-test-token')
    if request_id:
        fields['request_id'] = request_id
    return request('/import', fields, files)


def image_bytes(fmt, size=(1200, 600), orientation=None, color=(50, 120, 200)):
    img = Image.new('RGB', size, color)
    # Four distinctive quadrants also verify EXIF rotation/reflection.
    for box, fill in [((0,0,size[0]//2,size[1]//2),(240,10,10)),
                      ((size[0]//2,0,size[0],size[1]//2),(10,240,10)),
                      ((0,size[1]//2,size[0]//2,size[0]),(10,10,240))]:
        img.paste(fill, box)
    stream = io.BytesIO()
    exif = Image.Exif()
    if orientation:
        exif[274] = orientation
    img.save(stream, fmt, exif=exif)
    return stream.getvalue()


def asset_of(receipt):
    return receipt['project']['versions'][0]['assets'][0]


def original_path(receipt):
    asset = asset_of(receipt)
    return '/tmp/p2-storage/' + receipt['version_id'] + '/' + asset['id'] + '.' + asset['name'].rsplit('.',1)[1].lower()


def run_checks():
    ok(request('/schema'))
    limits = ok(request('/list'))['limits']
    require(limits == dict(max_files=64, max_file_bytes=512*1048576, per_extension_bytes={'csv':16*1048576,'txt':16*1048576},
                          description_max_chars=10000, request_max_bytes=1073741824,
                          multipart_overhead_bytes=2097152, max_total_bytes=1071644672), 'one published limits contract reserves 2 MiB below 1 GiB request limit')
    ini_probe = command(['exec',CONTAINER,'php','-d','upload_max_filesize=8M','-d','post_max_size=20M','-d','max_file_uploads=20','-r',
      "define('PHPWG_ROOT_PATH','/tmp/p2-http/'); require '/tmp/p2-http/plugins/yudao_design/include/library.php'; echo json_encode(yudao_design_limits());"]).stdout
    lowered = json.loads(ini_probe)
    require(lowered['max_files']==20 and lowered['max_file_bytes']==8*1048576 and lowered['per_extension_bytes']['csv']==8*1048576 and lowered['request_max_bytes']==20*1048576 and lowered['max_total_bytes']==18*1048576, 'limits consistently respect lower PHP upload/post/count ini values')
    # Request UUID remains idempotent after addition of previews and captions.
    retry_fields = dict(title='幂等',region='P2',version='R1',description='😀',project_id='',manifest='[]',request_id=str(uuid.uuid4()),pwg_token='isolated-test-token')
    retry_files = [('幂等.png',image_bytes('PNG',(72,24)))]
    first = ok(request('/import',retry_fields,retry_files))
    counts = ok(request('/counts'))
    require(ok(request('/import',retry_fields,retry_files))==first and ok(request('/counts'))==counts, 'P2 exact request UUID retry returns identical receipt without duplicate version')
    require(request('/import',dict(retry_fields,description='changed'),retry_files)['err']==409, 'P2 request UUID rejects altered metadata')
    # Validator's existing 100 MP pixel budget is shared by preview generator.
    import struct, zlib
    giant = bytearray(image_bytes('PNG',(10,10)))
    giant[16:24] = struct.pack('>II',11000,11000)
    giant[29:33] = struct.pack('>I',zlib.crc32(giant[12:29]))
    require(upload([('超像素.png',bytes(giant))])['err']==400, 'image validator rejects over-100MP image header before GD allocation')
    alpha = Image.new('RGBA',(1200,600),(60,100,180,70))
    buf = io.BytesIO(); alpha.save(buf,'PNG')
    translucent = asset_of(ok(upload([('透明.png',buf.getvalue())])))
    rendered = Image.open(io.BytesIO(fetch(translucent['previews']['400'])[2])).convert('RGBA')
    require(rendered.getpixel((100,100))[3] in range(68,73), 'PNG preview preserves transparency')
    for fmt, ext, mime in [('JPEG','jpg','image/jpeg'), ('PNG','png','image/png'), ('WEBP','webp','image/webp')]:
        content = image_bytes(fmt)
        receipt = ok(upload([('中文封面😀.'+ext, content)], request_id=str(uuid.uuid4())))
        asset = asset_of(receipt)
        require(asset['sha256'] == hashlib.sha256(content).hexdigest() and asset['bytes'] == len(content), fmt+' original hash/bytes unchanged')
        require(set(asset['previews']) == {'400','800'}, fmt+' public previews contract includes both sizes')
        require(ok(request('/get?project_id='+receipt['project_id']))['limits'] == limits, 'get/list share limits')
        for edge, expected in [('400',(400,200)),('800',(800,400))]:
            status, headers, body, _ = fetch(asset['previews'][edge])
            require(status == 200 and headers['Content-Type'] == mime and Image.open(io.BytesIO(body)).size == expected, fmt+' '+edge+' dimensions and MIME')
            out = OUTPUT.parent / ('preview-'+ext+'-'+edge+'.'+ext)
            out.write_bytes(body)
            mtime_before = command(['exec',CONTAINER,'stat','-c','%Y', '/tmp/p2-storage/.previews/'+asset['sha256']+'-'+edge+'-v1.'+ext]).stdout
            again = fetch(asset['previews'][edge])
            mtime_after = command(['exec',CONTAINER,'stat','-c','%Y', '/tmp/p2-storage/.previews/'+asset['sha256']+'-'+edge+'-v1.'+ext]).stdout
            require(again[2] == body and mtime_before == mtime_after, fmt+' '+edge+' cache hit stable body and mtime')
            require(fetch(asset['previews'][edge], headers={'If-None-Match':headers['ETag']})[0] == 304, fmt+' '+edge+' conditional GET 304')
            require(fetch(asset['previews'][edge], method='HEAD')[2] == b'', fmt+' '+edge+' HEAD has no body')
        status, headers, body, _ = fetch(asset['url']+'&download=1')
        require(status == 200 and body == content and 'filename*=UTF-8' in headers['Content-Disposition'], fmt+' Chinese filename download returns original exact bytes')
        require(fetch(asset['url'], headers={'Range':'bytes=0-9'})[2] == content[:10], fmt+' original range behavior preserved')
        require(fetch(asset['previews']['400'].replace('size=400','size=401'))[0] == 400, 'unsupported preview size rejected')

    small = ok(upload([('小图.png', image_bytes('PNG',(32,16)))]))
    require(Image.open(io.BytesIO(fetch(asset_of(small)['previews']['800'])[2])).size == (32,16), 'small image is never enlarged')
    # Verify all EXIF orientations with Pillow's independent reference transform.
    from PIL import ImageOps
    for orientation in range(1,9):
        content = image_bytes('JPEG',(1200,600),orientation)
        receipt = ok(upload([('方向'+str(orientation)+'.jpg',content)]))
        body = fetch(asset_of(receipt)['previews']['400'])[2]
        image = Image.open(io.BytesIO(body)).convert('RGB')
        ref = ImageOps.exif_transpose(Image.open(io.BytesIO(content))).convert('RGB')
        ref.thumbnail((400,400))
        require(image.size == ref.size, 'EXIF '+str(orientation)+' oriented dimensions')
        corners = [(image.width//4,image.height//4),(3*image.width//4,image.height//4),(image.width//4,3*image.height//4),(3*image.width//4,3*image.height//4)]
        require(all(max(abs(a-b) for a,b in zip(image.getpixel(xy),ref.getpixel(xy))) < 12 for xy in corners), 'EXIF '+str(orientation)+' quadrant orientation/reflection preserved')
        if orientation == 6:
            (OUTPUT.parent/'preview-exif6.jpg').write_bytes(body)
    # Concurrent cache miss uses lock + atomic rename: all 8 responses identical.
    receipt = ok(upload([('并发.png',image_bytes('PNG',(1100,510)))]))
    asset = asset_of(receipt)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(pool.map(lambda _:fetch(asset['previews']['800']),range(8)))
    require(all(r[0] == 200 and r[2] == responses[0][2] for r in responses), '8 simultaneous HTTP cache misses return identical complete GD image')
    require(Image.open(io.BytesIO(responses[0][2])).size == (800,371), 'concurrent output dimensions')
    require(not command(['exec',CONTAINER,'sh','-c','find /tmp/p2-storage/.previews -name ".preview-*"']).stdout.strip(), 'atomic generation leaves no temporary files')
    path = original_path(receipt)
    command(['exec',CONTAINER,'cp',path,path+'.backup'])
    command(['exec',CONTAINER,'sh','-c','printf broken > "$1"','test-corruption',path])
    require(fetch(asset['previews']['800'])[2] == responses[0][2], 'cache hit serves without decoding unreadable original')
    # Uncached bad image falls back to original through real original endpoint.
    status, _, body, url = fetch(asset['previews']['400'])
    require(status == 200 and body == b'broken' and '/file.php?' in url, 'GD decode failure redirects original; original download unaffected by preview code')
    command(['exec',CONTAINER,'mv',path+'.backup',path])
    original = fetch(asset['url'])[2]
    require(hashlib.sha256(original).hexdigest() == asset['sha256'], 'fixture restored, original SHA unchanged after previews/concurrency')
    # A blocked cache directory represents an unavailable/unwritable cache.
    command(['exec',CONTAINER,'mv','/tmp/p2-storage/.previews','/tmp/p2-storage/.previews.backup'])
    command(['exec',CONTAINER,'touch','/tmp/p2-storage/.previews'])
    status, _, body, url = fetch(asset['previews']['400'])
    require(status == 200 and body == original and '/file.php?' in url, 'unwritable cache path falls back to original exact bytes')
    command(['exec',CONTAINER,'rm','/tmp/p2-storage/.previews'])
    command(['exec',CONTAINER,'mv','/tmp/p2-storage/.previews.backup','/tmp/p2-storage/.previews'])
    text = ok(upload([('边界.csv',b'x'*(16*1048576))]))
    require(text['saved'], 'real multipart CSV exactly 16 MiB accepted')
    bad = upload([('超界.csv',b'x'*(16*1048576+1))])
    require(bad['err'] == 413 and '超界.csv' in bad['message'] and 'CSV' in bad['message'], 'real multipart CSV 16 MiB+1 rejected with filename/type')
    require(upload([('超界.txt',b'x'*(16*1048576+1))])['err'] == 413, 'real multipart TXT 16 MiB+1 rejected')
    require(fetch(asset_of(text)['url'].replace('file.php','thumbnail.php')+'&size=400')[0] == 400, 'non-image preview rejected')
    require(ok(upload([('说明.txt',b'ok')],description='😀'*10000))['saved'], 'real multipart description accepts 10000 emoji code points')
    require(upload([('说明.txt',b'ok')],description='😀'*10001)['err'] == 400, 'real multipart description rejects 10001 emoji code points')
    require(ok(upload([('中文说明.txt',b'ok')],description='中'*10000))['saved'], 'description accepts 10000 Chinese code points')
    require(upload([('中文说明.txt',b'ok')],description='中'*10001)['err'] == 400, 'description rejects 10001 Chinese code points')
    for total, accepted in [(limits['max_total_bytes'],True),(limits['max_total_bytes']+1,False)]:
        val = request('/budget?'+urllib.parse.urlencode(dict(name='预算.png',bytes=1,total=total)))
        require((val['stat']=='ok') == accepted, 'HTTP helper total budget boundary '+str(total))
    require(request('/budget?'+urllib.parse.urlencode(dict(name='通用.pdf',bytes=512*1048576,total=512*1048576)))['stat']=='ok', 'generic 512 MiB size boundary')
    require(request('/budget?'+urllib.parse.urlencode(dict(name='通用.pdf',bytes=512*1048576+1,total=512*1048576+1)))['err']==413, 'generic 512 MiB+1 rejected')
    # Real upload of 64 maximal byte-length Chinese names, emoji text + manifest.
    files = [('中'*83+f'{i:02}.txt',b'x') for i in range(64)]
    manifest = json.dumps([dict(name=n,role='document') for n,_ in files],ensure_ascii=False)
    fields = dict(title='最大表单',region='测试',version=str(uuid.uuid4()),description='😀'*10000,project_id='',manifest=manifest,pwg_token='isolated-test-token')
    body, _ = multipart(fields,files)
    overhead = len(body)-sum(len(b) for _,b in files)
    require(max(len(n.encode()) for n,_ in files)==255 and overhead < limits['multipart_overhead_bytes'], '64 Chinese names + manifest + 10000 emoji measured multipart overhead fits 2 MiB')
    require(ok(request('/import',fields,files))['saved'], 'real multipart 64 Chinese filename assets plus maximum metadata saved')
    fields['manifest'] = json.dumps([dict(name=n,role='document') for n,_ in files+[('第65个.txt',b'x')]],ensure_ascii=False)
    require(request('/import',fields,files+[('第65个.txt',b'x')])['err']==400, '65-file manifest rejected even when PHP truncates files at ini max_file_uploads=64')
    # Captions are a separate persistence layer; no version JSON modifications.
    caption_receipt = ok(upload([('说明图.png',image_bytes('PNG',(93,31))),('辅助图.png',image_bytes('PNG',(84,28))),('说明文.txt',b'text')]))
    pid = caption_receipt['project_id']
    assets = caption_receipt['project']['versions'][0]['assets']
    image1,image2,document = assets
    other_id = asset_of(small)['id']
    before = ok(request('/digest'))
    def annotate(patch, route='/annotate', admin=True, token='isolated-test-token'):
        return request(route,dict(project_id=pid,captions=json.dumps(patch,ensure_ascii=False),pwg_token=token),admin=admin)
    require(ok(request('/methods'))['yudaoDesign.projects.annotate']['options'] == {'admin_only':True,'post_only':True}, 'annotate WS requires admin and POST')
    require(annotate({image1['id']:'说明'},admin=False)['err']==403, 'guest cannot annotate')
    require(annotate({image1['id']:'说明'},token='wrong')['err']==403, 'wrong token cannot annotate')
    saved = ok(annotate({image1['id']:'😀'*240,image2['id']:'第二张图片'}))
    require(saved['saved'] and saved['project_id']==pid and saved['warning'] is None and saved['project']['versions'][0]['assets'][0]['caption']=='😀'*240, '240 emoji caption persists with saved receipt and public asset.caption')
    require(annotate({image1['id']:'😀'*241})['err']==400, '241 Unicode code point caption rejected')
    require(annotate({other_id:'跨项目'})['err']==400, 'cross-project image caption rejected')
    require(annotate({document['id']:'不是图片'})['err']==400, 'non-image asset caption rejected')
    require(annotate({image1['id']:99})['err']==400, 'non-string caption rejected')
    require(annotate({image1['id']:'nul\0'})['err']==400, 'NUL caption rejected')
    require(annotate([])['err']==400, 'captions array rejected; must be object')
    require(annotate({image1['id']:'不应提交',other_id:'非法'})['err']==400, 'mixed valid/invalid caption patch rejected atomically')
    preserve = ok(annotate({}))['project']['versions'][0]['assets']
    require(preserve[0]['caption']=='😀'*240 and preserve[1]['caption']=='第二张图片', 'empty caption object preserves omitted captions after invalid patch')
    deleted = ok(annotate({image1['id']:''}))['project']['versions'][0]['assets']
    require(deleted[0]['caption']=='' and deleted[1]['caption']=='第二张图片', 'empty string deletes only target caption; omitted image stays')
    fault = ok(annotate({image1['id']:'已提交但读取失败'},'/fault-annotate'))
    require(fault['saved'] and fault['project'] is None and bool(fault['warning']), 'postcommit caption detail failure still returns saved=true with warning')
    require(ok(request('/get?project_id='+pid))['project']['versions'][0]['assets'][0]['caption']=='已提交但读取失败', 'postcommit caption fault really persisted')
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        annotation_results = list(pool.map(lambda patch:ok(annotate(patch)),[{image1['id']:'并发一'},{image2['id']:'并发二'}]))
    final_assets = ok(request('/get?project_id='+pid))['project']['versions'][0]['assets']
    require(all(r['saved'] for r in annotation_results) and final_assets[0]['caption']=='并发一' and final_assets[1]['caption']=='并发二', 'concurrent caption patches serialize and preserve independent images')
    require(ok(request('/digest'))==before, 'all caption operations preserve original version.document including name/SHA/assets')
    db('DROP TABLE yudao_p2_isolated.p2_yudao_asset_captions;')
    legacy = ok(request('/get?project_id='+pid))['project']['versions'][0]['assets']
    require(legacy[0]['caption']=='' and legacy[1]['caption']=='', 'missing captions table preserves legacy project reads with empty caption')
    require(annotate({image1['id']:'upgrade'})['err']==503, 'annotation write requires explicit schema upgrade')
    ok(request('/schema'))
    warm1 = json.loads(command(['exec','-w','/tmp/p2-http',CONTAINER,'php','plugins/yudao_design/thumbnail_warm.php']).stdout)
    warm2 = json.loads(command(['exec','-w','/tmp/p2-http',CONTAINER,'php','plugins/yudao_design/thumbnail_warm.php']).stdout)
    require(warm1['images']>0 and warm1['fallbacks']==0 and warm1['generated']>0, 'CLI warm executes from Piwigo root and generates missing previews')
    require(warm2['images']==warm1['images'] and warm2['generated']==0 and warm2['hits']==2*warm2['images'] and warm2['fallbacks']==0, 'second CLI warm is complete cache hit for every 400/800 variant')
    return dict(limits=limits, warm_first=warm1, warm_second=warm2, measured_maximal_metadata_overhead_bytes=overhead, counts=ok(request('/counts')),
                total_budget_note='1 GiB boundary exercised via exact import size validator over HTTP; no 1 GiB payload allocation')


def main():
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    started = time.time()
    with tempfile.TemporaryDirectory(prefix='yudao-p2-http-') as scratch:
        fixture = Path(scratch)/'http'
        (fixture/'include').mkdir(parents=True)
        shutil.copytree(ROOT/'plugins/yudao_design',fixture/'plugins/yudao_design')
        lib = fixture/'plugins/yudao_design/include/library.php'
        lib.write_text(lib.read_text().replace('function yudao_design_get_project($id)', 'function yudao_design_p2_actual_get_project($id)'))
        shutil.copy(Path(__file__).with_name('p2_backend_bootstrap.php'),fixture/'include/common.inc.php')
        shutil.copy(Path(__file__).with_name('p2_backend_router.php'),fixture/'router.php')
        command(['rm','-f',CONTAINER],check=False)
        db("DROP DATABASE IF EXISTS yudao_p2_isolated; CREATE DATABASE yudao_p2_isolated CHARACTER SET utf8mb4; GRANT ALL ON yudao_p2_isolated.* TO 'piwigo'@'%';")
        try:
            command(['create','--name',CONTAINER,'--network','yudao-piwigo_default',
                     '--env-file',str(ROOT.parent/'piwigo-runtime-evidence/yudao-piwigo.env'),
                     '-e','PHP_CLI_SERVER_WORKERS=4','-e','YUDAO_P2_TEST=1','-p','127.0.0.1:8789:8080','--entrypoint','php',
                     'yudao-piwigo-piwigo','-d','display_errors=0','-S','0.0.0.0:8080','-t','/tmp/p2-http','/tmp/p2-http/router.php'])
            command(['cp',str(fixture),CONTAINER+':/tmp/p2-http'])
            command(['start',CONTAINER])
            command(['exec',CONTAINER,'mkdir','-p','/tmp/p2-storage'])
            for _ in range(50):
                try:
                    request('/list')
                    break
                except Exception:
                    time.sleep(.1)
            lint = []
            for path in ('main.inc.php','file.php','thumbnail.php','thumbnail_warm.php','include/library.php','include/thumbnail.php'):
                lint.append(command(['exec',CONTAINER,'php','-l','/tmp/p2-http/plugins/yudao_design/'+path]).stdout.strip())
            details = run_checks()
            result = dict(passed=True,checks=len(checks),assertions=checks,lint=lint,elapsed_seconds=round(time.time()-started,2),
                          environment='isolated MariaDB yudao_p2_isolated, PHP 8.3 GD/EXIF, 4 HTTP workers/8789; production and P1 DB untouched',**details)
            OUTPUT.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
            print(json.dumps(dict(passed=True,checks=len(checks),evidence=str(OUTPUT)),ensure_ascii=False))
        except Exception as error:
            OUTPUT.write_text(json.dumps(dict(passed=False,checks=len(checks),assertions=checks,error=str(error)),ensure_ascii=False,indent=2)+'\n')
            raise
        finally:
            OUTPUT.with_suffix('.http.log').write_text(command(['logs',CONTAINER],check=False).stderr)
            command(['rm','-f',CONTAINER],check=False)
            db('DROP DATABASE IF EXISTS yudao_p2_isolated;')


if __name__=='__main__':
    main()
