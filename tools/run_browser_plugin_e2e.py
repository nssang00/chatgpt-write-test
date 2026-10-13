#!/usr/bin/env python3
"""Run a real CEF or WebView2 browser/plugin smoke test (no mocks).

Exit nonzero on missing SDK build artifacts, timeout, failure, or lost checkpoints.
"""
import argparse
import os
from pathlib import Path
import signal
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', choices=('cef', 'webview2'), required=True)
    parser.add_argument('--build-dir', type=Path, required=True)
    parser.add_argument('--timeout', type=int, default=120)
    args = parser.parse_args()

    if args.engine == 'webview2' and os.name != 'nt':
        parser.error('WebView2 must be tested on Windows')

    project = Path(__file__).resolve().parent.parent
    html = project / 'tests/integration/cef/plugin_bridge_test.html'
    bin_dir = args.build_dir.resolve() / 'bin'
    exe_suffix = '.exe' if os.name == 'nt' else ''
    exe_name = 'nativeweb_' + args.engine + '_bridge_integration' + exe_suffix
    lib_name = ('nativeweb_plugin_browser_fixture.dll' if os.name == 'nt'
                else 'libnativeweb_plugin_browser_fixture.so')
    executable = bin_dir / exe_name
    plugin = bin_dir / lib_name
    child = project / 'tests/integration/cef/plugin_untrusted_child.html'
    for path in (html, child, executable, plugin):
        if not path.is_file():
            parser.error('Required E2E input missing: ' + str(path))

    command = [str(executable), '--url=' + html.as_uri(),
               '--plugin-path=' + str(plugin)]
    if args.engine == 'cef':
        # Chromium subprocess startup resolves ICU data and locale resources
        # relative to the runtime executable directory. Match the existing
        # CEF bridge CI contract on Linux and explicitly disable sandboxing.
        command.insert(1, '--no-sandbox')
    if args.engine == 'cef' and sys.platform.startswith('linux') and not os.getenv('DISPLAY'):
        from shutil import which
        if not which('xvfb-run'):
            parser.error('CEF needs DISPLAY or xvfb-run')
        command = ['xvfb-run', '-a'] + command

    print('Browser E2E:', args.engine, flush=True)
    print('Command:', command, flush=True)
    kwargs = {}
    if args.engine == 'cef':
        kwargs['cwd'] = str(bin_dir)
    if os.name == 'posix':
        kwargs['start_new_session'] = True
    process = subprocess.Popen(command, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, text=True, **kwargs)
    try:
        output, _ = process.communicate(timeout=args.timeout)
    except subprocess.TimeoutExpired:
        if os.name == 'posix':
            os.killpg(process.pid, signal.SIGKILL)
        else:
            subprocess.run(['taskkill', '/F', '/T', '/PID', str(process.pid)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           check=False)
        output, _ = process.communicate()
        print(output, end='')
        print('Browser E2E timed out', file=sys.stderr)
        return 124

    print(output, end='')
    markers = ('checkpoint: security-same-entry-iframe-blocked',
               'checkpoint: security-untrusted-frame-blocked',
               'checkpoint: plugin-js-verified',
               'checkpoint: plugin-busy-verified',
               'checkpoint: plugin-unloaded',
               'checkpoint: plugin-e2e-complete')
    missing = [m for m in markers if m not in output]
    forbidden = 'checkpoint: security-UNTRUSTED-CALL-EXECUTED' in output
    if process.returncode != 0 or missing or forbidden or 'bridge-fail:' in output:
        print('Browser E2E failed: exit={}, missing={}'.format(
              process.returncode, ', '.join(missing)), file=sys.stderr)
        return 1
    print('Browser plugin E2E: PASS')
    return 0


if __name__ == '__main__':
    sys.exit(main())
