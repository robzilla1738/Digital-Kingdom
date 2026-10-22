#!/usr/bin/env python3
"""Create a clean HEAD archive with reused external dependencies, never developer workspace sources.
Run from the repository root. Returns a JSON receipt; run checks in its archive path.
No network access or dependency installation. The archive is deliberately retained for review.
"""
from pathlib import Path
import subprocess, os, json
repo=Path.cwd().resolve()
sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
dest=Path('/tmp')/('dk-clean-'+sha[:12]);dest.mkdir(exist_ok=False)
archive=subprocess.Popen(['git','archive',sha],cwd=repo,stdout=subprocess.PIPE)
subprocess.run(['tar','-x','-C',str(dest)],stdin=archive.stdout,check=True);archive.stdout.close();assert archive.wait()==0
packages=[Path(p).parent for p in subprocess.check_output(['git','ls-files','*package.json'],cwd=repo,text=True).splitlines()]
linked=[]
for package in packages:
 source=repo/package/'node_modules'
 if not source.exists():continue
 target=dest/package/'node_modules';target.mkdir(parents=True,exist_ok=True)
 for dependency in source.iterdir():
  if dependency.name=='@dk':
   scope=target/'@dk';scope.mkdir(exist_ok=True)
   for local in dependency.iterdir():
    relative=local.resolve().relative_to(repo)
    os.symlink(dest/relative,scope/local.name,target_is_directory=True)
    linked.append({'package':str(package),'workspace':local.name,'target':str(relative)})
  else:os.symlink(dependency.resolve(),target/dependency.name,target_is_directory=dependency.is_dir())
print(json.dumps({'sha':sha,'archive':str(dest),'workspaceLinks':linked,'dependencyCondition':'Only already installed external dependencies are shared; all @dk workspace imports point to this clean archive.'}))
