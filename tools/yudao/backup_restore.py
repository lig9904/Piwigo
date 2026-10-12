#!/usr/bin/env python3
"""Project-only consistent NAS backup and isolated restoration; secrets stay on NAS."""
import argparse, fcntl, hashlib, http.cookiejar, json, os, pathlib, shutil, subprocess, tarfile, time, urllib.request, urllib.parse, uuid, shlex

def run(*args, **kw):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kw).stdout

def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]

def sha(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()

def api(base, opener=None):
    with (opener.open if opener else urllib.request.urlopen)(base+'/ws.php?format=json&method=yudaoDesign.projects.list', timeout=30) as r:
        value=json.load(r)
    if value.get('stat')!='ok': raise RuntimeError('Public project API failed')
    return value['result']['projects']

def wait_app(name, base):
    for _ in range(60):
        try:
            return api(base)
        except Exception:
            if not inspect(name)['State']['Running']: raise RuntimeError('Restored app stopped')
            time.sleep(1)
    raise RuntimeError('Restored app readiness timeout')

def verify(projects, materials, opener=None):
    checks=[]
    for p in projects:
        for v in p['versions']:
            for a in v['assets']:
                with (opener.open if opener else urllib.request.urlopen)(a['url'],timeout=60) as r:
                    h=hashlib.sha256(); size=0
                    for b in iter(lambda:r.read(1024*1024),b''): h.update(b); size+=len(b)
                if h.hexdigest()!=a['sha256'] or size!=a['bytes']: raise RuntimeError('Original asset mismatch '+a['id'])
                checks.append({'id':a['id'],'sha256':h.hexdigest(),'bytes':size})
    return checks

def restore(backup, image, db_image, env, scratch, baseline):
    # Never mount live paths. Container/network names cannot collide with the live project.
    ident='yudao-restore-'+uuid.uuid4().hex[:12]
    db=ident+'-db'; app=ident+'-app'; net=ident+'-net'
    env_path=scratch/'db.env'; created_scratch=False; created_net=False; created_db=False; created_app=False
    try:
        scratch.mkdir(mode=0o700); created_scratch=True; scratch.chmod(0o700); html=scratch/'html'; materials=scratch/'materials'
        for filename, target in [('html.tar.gz',html),('materials.tar.gz',materials)]:
            target.mkdir(mode=0o750)
            with tarfile.open(backup/filename) as t:
                # Locally created archives only; reject any traversal or external symlinks.
                for m in t.getmembers():
                    dest=(target/m.name).resolve()
                    if not dest.is_relative_to(target.resolve()): raise RuntimeError('Unsafe archive path')
                    if m.issym() or m.islnk(): raise RuntimeError('Backup symlink unsupported')
                t.extractall(target)
        os.chown(materials,33,33)
        env_path=scratch/'db.env'; env_path.write_text('\n'.join(k+'='+v for k,v in env.items())+'\n'); env_path.chmod(0o600)
        run('docker','network','create',net); created_net=True
        run('docker','create','--name',db,'--network',net,'--network-alias','database','--env-file',str(env_path),db_image); created_db=True
        run('docker','start',db)
        for _ in range(90):
            if subprocess.run(['docker','exec',db,'healthcheck.sh','--connect','--innodb_initialized'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0: break
            time.sleep(1)
        else: raise RuntimeError('Restored database readiness timeout')
        with open(backup/'database.sql','rb') as f:
            run('docker','exec','-i',db,'sh','-c','MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb -uroot "$MARIADB_DATABASE"',stdin=f)
        run('docker','create','--name',app,'--network',net,'-p','127.0.0.1::80','-e','YUDAO_STORAGE_ROOT=/var/lib/yudao-design','-v',str(html)+':/var/www/html','-v',str(materials)+':/var/lib/yudao-design',image); created_app=True
        run('docker','start',app)
        port=inspect(app)['NetworkSettings']['Ports']['80/tcp'][0]['HostPort']; base='http://127.0.0.1:'+port
        wait_app(app,base)
        php='$_SERVER["REMOTE_ADDR"]="127.0.0.1"; define("PHPWG_ROOT_PATH","../../"); define("YUDAO_DESIGN_ENTRY",true); require "../../include/common.inc.php"; require_once "include/library.php"; yudao_design_schema();'
        run('docker','exec','-w','/var/www/html/plugins/yudao_design',app,'php','-r',php)
        # Use the archived native admin account for read-only restored HTTP checks.
        # Login-only projects must be included; credentials never leave this process.
        with tarfile.open(backup/'runtime.tar.gz') as t:
            credentials=json.load(t.extractfile('admin-access.json'))
        opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        login=urllib.parse.urlencode({'method':'pwg.session.login','username':credentials['username'],'password':credentials['password']}).encode()
        with opener.open(base+'/ws.php?format=json',data=login,timeout=30) as r:
            if json.load(r).get('stat')!='ok': raise RuntimeError('Restored administrator login failed')
        projects=api(base,opener)
        def stable(ps):
            # Original immutable fields and presentation settings, excluding URL host and derived previews.
            return [{k:p[k] for k in ['id','title','region','created_at','current_version_id','cover_asset_id']} | {'visibility':p.get('visibility','public'),'interactive_models':p['interactive_models'],'versions':[{k:v[k] for k in ['id','label','created_at','description']} | {'assets':[{k:a[k] for k in ['id','name','kind','role','bytes','sha256']} | {'caption':a.get('caption','')} for a in v['assets']]} for v in p['versions']]} for p in ps]
        if stable(projects)!=stable(baseline): raise RuntimeError('Restored project metadata mismatch')
        asset_checks=verify(projects,materials,opener)
        interactive=[]
        for p in projects:
            for m in p['interactive_models']:
                with opener.open(base+'/'+urllib.parse.quote(m['url'],safe='/?=&%'),timeout=30) as r:
                    data=r.read()
                    if b'<html' not in data.lower(): raise RuntimeError('Interactive HTML missing')
                    interactive.append({'key':m['key'],'sha256':hashlib.sha256(data).hexdigest()})
        return {'image':inspect(app)['Image'],'projects':len(projects),'versions':sum(len(p['versions']) for p in projects),'assets':len(asset_checks),'allOriginalHashesVerified':True,'assetChecks':asset_checks,'interactiveModels':interactive,'isolated':True,'bind':'127.0.0.1','allPassed':True}
    finally:
        for name,created in [(app,created_app),(db,created_db)]:
            if created: subprocess.run(['docker','rm','-fv',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        if created_net: subprocess.run(['docker','network','rm',net],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        if created_scratch:
            env_path.unlink(missing_ok=True)
            shutil.rmtree(scratch,ignore_errors=True)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('destination',type=pathlib.Path)
    parser.add_argument('--runtime',type=pathlib.Path,default=pathlib.Path('/vol1/1000/yudao-piwigo'))
    parser.add_argument('--materials',type=pathlib.Path,default=pathlib.Path('/vol2/1000/design-library/materials'))
    parser.add_argument('--project',default='yudao-piwigo')
    parser.add_argument('--app',default='yudao-piwigo-piwigo-1'); parser.add_argument('--db',default='yudao-piwigo-database-1')
    parser.add_argument('--base',default='http://192.168.200.20:8081')
    parser.add_argument('--verify-restore',action='store_true')
    parser.add_argument('--restore-only',action='store_true')
    parser.add_argument('--restore-image',help='Optional already-built image to verify an upgrade or rollback on restored data')
    args=parser.parse_args(); os.umask(0o077)
    with open(args.runtime/'.backup.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        dest=args.destination.resolve()
        if args.restore_only:
            manifest=json.loads((dest/'manifest.json').read_text())
            for name,meta in manifest['archives'].items():
                if sha(dest/name)!=meta['sha256']: raise RuntimeError('Backup archive checksum mismatch '+name)
            if (dest/'database.env').is_file():
                env=dict(line.split('=',1) for line in (dest/'database.env').read_text().splitlines() if line)
            else:
                # Compatibility with snapshots predating database.env; never consult the live DB.
                with tarfile.open(dest/'runtime.tar.gz') as t: text=t.extractfile('.env').read().decode()
                values={}
                for line in text.splitlines():
                    if not line.strip() or line.lstrip().startswith('#') or '=' not in line: continue
                    key,value=line.split('=',1); words=shlex.split(value)
                    if len(words)!=1: raise RuntimeError('Unsupported legacy env syntax')
                    values[key.strip()]=words[0]
                env={'MARIADB_DATABASE':values.get('PIWIGO_DB_NAME','piwigo'),'MARIADB_USER':values.get('PIWIGO_DB_USER','piwigo'),'MARIADB_PASSWORD':values['PIWIGO_DB_PASSWORD'],'MARIADB_ROOT_PASSWORD':values['MARIADB_ROOT_PASSWORD']}
            for image in [args.restore_image or manifest['appImage'],manifest['databaseImage']]:
                if subprocess.run(['docker','image','inspect',image],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
                    run('docker','load','-i',str(dest/'images.tar'))
            result=restore(dest,args.restore_image or manifest['appImage'],manifest['databaseImage'],env,dest.parent/(dest.name+'-restore'),json.loads((dest/'projects.json').read_text()))
            (dest/'restore-results.json').write_text(json.dumps(result,indent=2));(dest/'restore-results.json').chmod(0o600)
            print(json.dumps({k:v for k,v in result.items() if k!='assetChecks'}));return
        if dest.exists(): raise RuntimeError('Refusing to overwrite existing backup')
        configuration=json.loads(run('docker','compose','-p',args.project,'--env-file',str(args.runtime/'.env'),'-f',str(args.runtime/'docker-compose.yml'),'config','--format','json'))
        source_path=pathlib.Path(configuration['services']['piwigo']['build']['context']).resolve()
        if not (source_path/'deploy/yudao/Dockerfile').is_file():raise RuntimeError('Configured source is incomplete')
        if any(dest.is_relative_to(x.resolve()) for x in [args.materials,args.runtime/'html',args.runtime/'source',source_path]): raise RuntimeError('Backup must be outside live data')
        state=inspect(args.app)
        if not state['State']['Running']: raise RuntimeError('Live app must be running before backup')
        dest.mkdir(parents=True,mode=0o700);dest.chmod(0o700)
        started=time.monotonic()
        try:
            run('docker','stop','--time','30',args.app)
            network=next(iter(state['NetworkSettings']['Networks']))
            php='$_SERVER["REMOTE_ADDR"]="127.0.0.1"; $_SERVER["HTTP_HOST"]="192.168.200.20:8081"; define("PHPWG_ROOT_PATH","../../"); define("YUDAO_DESIGN_ENTRY",true); require "../../include/common.inc.php"; require_once "include/library.php"; $user=build_user($conf["webmaster_id"],true); echo json_encode(yudao_design_list_projects());'
            baseline=json.loads(run('docker','run','--rm','--network',network,'--entrypoint','php','-w','/var/www/html/plugins/yudao_design','-e','YUDAO_STORAGE_ROOT=/var/lib/yudao-design','-v',str(args.runtime/'html')+':/var/www/html','-v',str(args.materials)+':/var/lib/yudao-design',state['Image'],'-r',php))
            (dest/'projects.json').write_text(json.dumps(baseline,ensure_ascii=False,indent=2))
            with open(dest/'database.sql','wb') as f:
                subprocess.run(['docker','exec',args.db,'sh','-c','MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb-dump -uroot --single-transaction --routines --triggers --events --hex-blob "$MARIADB_DATABASE"'],check=True,stdout=f,stderr=subprocess.PIPE)
            run('tar','-czf',str(dest/'html.tar.gz'),'-C',str(args.runtime/'html'),'.')
            run('tar','--exclude=./.previews','-czf',str(dest/'materials.tar.gz'),'-C',str(args.materials),'.')
            files=[n for n in ['.env','docker-compose.yml','admin-access.json'] if (args.runtime/n).is_file()]
            run('tar','-czf',str(dest/'runtime.tar.gz'),'-C',str(args.runtime),*files)
            run('tar','-czf',str(dest/'source.tar.gz'),'-C',str(source_path),'.')
        finally:
            run('docker','start',args.app)
        wait_app(args.app,args.base)
        pause_seconds=round(time.monotonic()-started,2)
        db_env=dict(x.split('=',1) for x in inspect(args.db)['Config']['Env'] if x.startswith('MARIADB_'))
        (dest/'database.env').write_text('\n'.join(k+'='+v for k,v in db_env.items())+'\n');(dest/'database.env').chmod(0o600)
        run('docker','image','save','-o',str(dest/'images.tar'),state['Image'],inspect(args.db)['Image'])
        manifest={'sourceContext':str(source_path),'appImage':state['Image'],'databaseImage':inspect(args.db)['Image'],'appPauseSeconds':pause_seconds,'archives':{p.name:{'sha256':sha(p),'bytes':p.stat().st_size} for p in dest.iterdir() if p.is_file()},'derivedPreviewCacheExcluded':True,'secretsIncludedKeepOnNAS':True}
        (dest/'manifest.json').write_text(json.dumps(manifest,indent=2))
        for file in dest.iterdir():
            if file.is_file(): file.chmod(0o600)
        if args.verify_restore:
            raw=inspect(args.db)['Config']['Env']; env=dict(x.split('=',1) for x in raw if x.startswith('MARIADB_'))
            result=restore(dest,state['Image'],inspect(args.db)['Image'],env,dest.parent/(dest.name+'-restore'),baseline)
            (dest/'restore-results.json').write_text(json.dumps(result,indent=2));(dest/'restore-results.json').chmod(0o600)
            print(json.dumps({'backup':str(dest),'appPauseSeconds':manifest['appPauseSeconds'],'restore':{k:v for k,v in result.items() if k!='assetChecks'}}))
        else: print(json.dumps({'backup':str(dest),'appPauseSeconds':manifest['appPauseSeconds']}))

if __name__=='__main__': main()
