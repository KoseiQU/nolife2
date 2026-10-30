# n2common.py — tools/blender/*.py 共通の小道具(引数・ログ)。
import sys, time

_T0 = time.time()

def parse_args(defaults):
    """Blender の `-- --key value --flag` 形式の引数を dict に。"""
    out = dict(defaults)
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a.startswith('--'):
            k = a[2:].replace('-', '_')
            if i + 1 < len(argv) and not argv[i + 1].startswith('--'):
                out[k] = argv[i + 1]; i += 2
            else:
                out[k] = True; i += 1
        else:
            i += 1
    return out

def log(msg):
    print(f'[n2 {time.time() - _T0:6.1f}s] {msg}', flush=True)
