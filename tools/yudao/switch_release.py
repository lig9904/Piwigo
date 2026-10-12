#!/usr/bin/env python3
"""Switch the existing NAS Compose project to an already built immutable image."""
import argparse, fcntl, json, os, pathlib, re, subprocess, time, urllib.request, uuid

def run(*args):
    return subprocess.run(args,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE).stdout

def status(base):
    with urllib.request.urlopen(base+'/ws.php?format=json&method=yudaoDesign.projects.list',timeout=15) as r:
        data=json.load(r)
    if data.get('stat')!='ok': raise RuntimeError('Project API not ready')
    return data

def main():
    p=argparse.ArgumentParser()
    p.add_argument('image');p.add_argument('--source',type=pathlib.Path,help='Immutable build source for future fnOS rebuilds');p.add_argument('--runtime',type=pathlib.Path,default=pathlib.Path('/vol1/1000/yudao-piwigo'))
    p.add_argument('--project',default='yudao-piwigo');p.add_argument('--base',default='http://192.168.200.20:8081')
    a=p.parse_args(); os.umask(0o077)
    if not re.fullmatch(r'yudao-piwigo:[A-Za-z0-9_.-]+',a.image):raise RuntimeError('Expected a local named release image')
    lock=open(a.runtime/'.backup.lock','a')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    run('docker','image','inspect',a.image)
    app=a.project+'-piwigo-1'
    previous_image=json.loads(run('docker','inspect',app))[0]['Image']
    path=a.runtime/'docker-compose.yml'; original=path.read_text()
    # Only this project's application image; never alter ports, volumes or database service.
    updated,n=re.subn(r'(?m)^(\s*image:)\s*(?:yudao-piwigo:[^\s]+|\$\{YUDAO_IMAGE:[^\n]+)\s*$',lambda m:m.group(1)+' '+a.image,original)
    if n!=1:raise RuntimeError('Expected exactly one application image field')
    if a.source:
        source=a.source.resolve()
        if not (source/'deploy/yudao/Dockerfile').is_file():raise RuntimeError('Release source is incomplete')
        updated,n=re.subn(r'(?m)^(\s*context:)\s*[^\n]+$',lambda m:m.group(1)+' '+str(source),updated)
        if n!=1:raise RuntimeError('Expected exactly one application build context')
    receipt=a.runtime/'releases'/uuid.uuid4().hex;receipt.mkdir(parents=True,mode=0o700);receipt.chmod(0o700)
    (receipt/'compose-before.yaml').write_text(original);(receipt/'compose-before.yaml').chmod(0o600)
    compose=['docker','compose','-p',a.project,'--env-file',str(a.runtime/'.env'),'-f',str(path)]
    path.write_text(updated)
    try:
        run(*compose,'up','-d','--no-build','--no-deps','piwigo')
        app=a.project+'-piwigo-1'
        for _ in range(60):
            try: status(a.base);break
            except Exception:time.sleep(1)
        else:raise RuntimeError('Release startup timeout before schema update')
        # Schema additions are additive; the previous plugin can still read this database.
        php='$_SERVER["REMOTE_ADDR"]="127.0.0.1"; define("PHPWG_ROOT_PATH","../../"); define("YUDAO_DESIGN_ENTRY",true); require "../../include/common.inc.php"; require_once "include/library.php"; yudao_design_schema();'
        run('docker','exec','-w','/var/www/html/plugins/yudao_design',app,'php','-r',php)
        for _ in range(60):
            try:
                data=status(a.base);break
            except Exception:time.sleep(1)
        else:raise RuntimeError('Release readiness timeout')
        actual=json.loads(run('docker','inspect',app))[0]['Image']
        expected=json.loads(run('docker','image','inspect',a.image))[0]['Id']
        if actual!=expected:raise RuntimeError('Running image does not match selected release')
        result={'image':a.image,'imageId':actual,'project':a.project,'projects':len(data['result']['projects']),'receipt':str(receipt),'saved':True}
        (receipt/'result.json').write_text(json.dumps(result,indent=2));(receipt/'result.json').chmod(0o600);print(json.dumps(result))
    except Exception as error:
        path.write_text(original)
        rollback={'saved':False,'rollbackVerified':False,'previousImage':previous_image,'failureType':type(error).__name__}
        try:
            run(*compose,'up','-d','--no-build','--no-deps','piwigo')
            for _ in range(60):
                try: status(a.base);break
                except Exception:time.sleep(1)
            else:raise RuntimeError('Rollback readiness timeout')
            actual=json.loads(run('docker','inspect',app))[0]['Image']
            if actual!=previous_image:raise RuntimeError('Rollback running image mismatch')
            rollback['rollbackVerified']=True
        finally:
            (receipt/'failure.json').write_text(json.dumps(rollback,indent=2));(receipt/'failure.json').chmod(0o600)
        raise

if __name__=='__main__':main()
