#!/usr/bin/env python3
"""Real generated C++ app CLI -> CEF/WebView2 -> app:// JS -> C++ integration.

No mock webview; a nonzero exit, missing browser checkpoint or timeout fails.
The browser SDK and host are already built explicitly by the integration CI.
"""
import argparse
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile

def execute(argv, cwd, timeout=90):
    kwargs = {"cwd":str(cwd), "stdout":subprocess.PIPE,
              "stderr":subprocess.STDOUT, "text":True}
    if os.name == "posix":
        kwargs["start_new_session"] = True
    process = subprocess.Popen(argv,**kwargs)
    try:
        output,_ = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        if os.name=="posix":
            os.killpg(process.pid,signal.SIGKILL)
        else:
            subprocess.run(["taskkill","/F","/T","/PID",str(process.pid)],
                           stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                           check=False)
        output,_ = process.communicate()
        print(output,flush=True)
        raise AssertionError("Generated desktop runner timed out")
    print("$", " ".join(str(v) for v in argv), "\n"+output,flush=True)
    return process.returncode,output

def run():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--xytron",type=Path,required=True)
    parser.add_argument("--sdk",type=Path,required=True)
    parser.add_argument("--host",type=Path,required=True)
    parser.add_argument("--engine",choices=("cef","webview2"),required=True)
    args=parser.parse_args()
    cli=args.xytron.resolve(strict=True)
    host=args.host.resolve(strict=True)
    sdk=args.sdk.resolve(strict=True)
    if args.engine=="webview2" and os.name!="nt":
        parser.error("WebView2 requires Windows")
    with tempfile.TemporaryDirectory(prefix="xytron-generated-e2e-") as tmp:
        folder=Path(tmp)
        base=[str(cli)]
        rc,output=execute(base+["new","desktop","hello","--backend","cpp"],folder)
        if rc: raise AssertionError("new desktop failed")
        project=folder/"hello"
        for argv in (
            ["restore","--sdk",str(sdk)],
            ["build"],
            ["test"],
        ):
            rc,output=execute(base+argv,project)
            if rc: raise AssertionError("generated app CLI workflow failed: "+" ".join(argv))
        # Verify invalid host paths are denied before launching anything.
        rc,_=execute(base+["run","--host",str(folder/"missing-host"),"--smoke"],
                     project)
        if rc==0: raise AssertionError("Missing executable was accepted")

        command=base+["run","--host",str(host),"--smoke"]
        if args.engine=="cef" and sys.platform.startswith("linux") and not os.getenv("DISPLAY"):
            if not shutil.which("xvfb-run"):
                raise AssertionError("Real CEF smoke requires DISPLAY or xvfb-run")
            command=["xvfb-run","-a"]+command
        rc,output=execute(command,project,timeout=140)
        markers=(
            "checkpoint: native-app-window-created",
            "checkpoint: native-app-ui-loaded app://desktop/index.html",
            "checkpoint: generated-app-js-native-pong",
            "Real browser app:// host completed successfully."
        )
        missing=[marker for marker in markers if marker not in output]
        if rc!=0 or missing or "bridge-fail:" in output:
            raise AssertionError("Real native app E2E failed: exit={} missing={}".format(
                rc,missing))

        # The host must never display an arbitrary external UI if app
        # validation is broken. Remove generated UI, then verify denial.
        ui=project/"ui"/"index.html"
        backup=ui.with_suffix(".saved")
        ui.rename(backup)
        try:
            rc,_=execute(base+["run","--host",str(host),"--smoke"],project)
            if rc==0: raise AssertionError("Missing application UI accepted")
        finally:
            backup.rename(ui)
        print("Generated app real {} browser E2E: PASS".format(args.engine),
              flush=True)
    return 0

if __name__=="__main__":
    try:
        sys.exit(run())
    except (AssertionError, OSError, subprocess.SubprocessError) as exc:
        print("Generated app real-browser E2E FAILED:",exc,file=sys.stderr)
        sys.exit(1)
