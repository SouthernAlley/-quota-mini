"""Check every archive file against a release commit without extracting or executing it."""
import argparse
import hashlib
import json
import subprocess
import zipfile
from pathlib import PurePosixPath

REQUIRED = {
    '.agents/plugins/marketplace.json', 'plugins/quota-mini/.codex-plugin/plugin.json',
    'plugins/quota-mini/server.mjs', 'plugins/quota-mini/lib/mcp.mjs',
    'plugins/quota-mini/ui/panel.html', 'plugins/quota-mini/ui/panel.js',
    'plugins/quota-mini/ui/panel.css', 'plugins/quota-mini/LICENSE', 'LICENSE', 'INSTALL.md',
}


def blob_sha(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def verify_archive(archive, version, tree):
    assert REQUIRED <= tree.keys(), 'Required release files missing from commit'
    prefix = f'quota-mini-{version}/'
    observed = {}
    with zipfile.ZipFile(archive) as bundle:
        for entry in bundle.infolist():
            assert entry.filename.startswith(prefix), 'Unexpected archive prefix'
            name = entry.filename[len(prefix):]
            assert '\\' not in name and '..' not in PurePosixPath(name).parts, 'Unsafe archive path'
            assert not PurePosixPath(name).is_absolute(), 'Absolute archive path'
            assert not name.endswith('/.mcp.json') and name != '.mcp.json', 'Generated configuration included'
            if entry.is_dir():
                continue
            assert name not in observed, f'Duplicate archive file: {name}'
            observed[name] = blob_sha(bundle.read(entry))
    assert observed.keys() == tree.keys(), 'Archive file list differs from release commit'
    for name, sha in observed.items():
        assert sha == tree[name], f'Archive contents differ: {name}'
    return len(observed)


def git_tree(commit):
    result = subprocess.check_output(['git', 'ls-tree', '-rz', '--full-tree', commit])
    tree = {}
    for item in result.split(b'\0'):
        if not item:
            continue
        meta, name = item.split(b'\t', 1)
        mode, kind, sha = meta.decode().split()
        assert mode == '100644' and kind == 'blob', 'Unsupported entry in source release'
        tree[name.decode('utf-8')] = sha
    return tree


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--zip', required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--commit', required=True)
    args = parser.parse_args()
    count = verify_archive(args.zip, args.version, git_tree(args.commit))
    print(json.dumps({'version': args.version, 'archiveFiles': count, 'contents': 'verified'}))
