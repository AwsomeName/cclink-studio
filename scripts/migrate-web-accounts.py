#!/usr/bin/env python3
"""Offline one-time Studio account/profile transfer. Python 3 standard library only."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

CATALOG = Path('web-resources/web-resources.json')
TABLES = ('websites', 'principals', 'accounts', 'accountGroups')
SKIP = {'Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
        'SingletonLock', 'SingletonCookie', 'SingletonSocket', 'LOCK'}


def fail(message):
    raise ValueError(message)


def read_catalog(root):
    path = root / CATALOG
    if path.stat().st_size > 2 * 1024 * 1024:
        fail('账号目录超过支持的大小。')
    data = json.loads(path.read_text())
    if data.get('schemaVersion') != 3 or not isinstance(data.get('revision'), int):
        fail('仅支持当前 v3 账号目录，请先升级 Studio。')
    for table in TABLES:
        rows = data.get(table)
        if not isinstance(rows, list) or any(not isinstance(r, dict) or not isinstance(r.get('id'), str) for r in rows):
            fail('账号目录格式错误。')
        if len({r['id'] for r in rows}) != len(rows):
            fail('账号目录包含重复 ID。')
    for account in data['accounts']:
        if not re.fullmatch(r'[A-Za-z0-9._-]{1,64}', account.get('browserProfileId', '')):
            fail('无效浏览器 Profile。')
        if account['browserProfileId'] in ('.', '..'):
            fail('无效浏览器 Profile。')
        for field, table in [('websiteId', 'websites'), ('principalId', 'principals')]:
            if account.get(field) not in {r['id'] for r in data[table]}:
                fail('账号引用不完整。')
    ids = {r['id'] for r in data['accounts']}
    for group in data['accountGroups']:
        if not isinstance(group.get('accountIds'), list) or not set(group['accountIds']) <= ids:
            fail('运营矩阵引用不完整。')
    return data


def profiles(data):
    return sorted({a['browserProfileId'] for a in data['accounts']})


def relative_profile(profile):
    # Chromium uses lowercase partition directory names.
    return Path('Partitions') / ('cclink-studio-profile-' + profile).lower()


def regular_tree(root):
    if root.is_symlink():
        fail('不支持符号链接目录。')
    for base, dirs, files in os.walk(root):
        for name in dirs + files:
            p = Path(base) / name
            if p.is_symlink() or not (p.is_file() or p.is_dir()):
                fail('迁移目录包含链接或特殊文件，已停止。')


def closed(root):
    if not shutil.which('lsof'):
        fail('需要系统 lsof 检查 Studio 是否已退出。')
    check = subprocess.run(['lsof', '-t', '+D', str(root)], capture_output=True, text=True)
    if check.stdout.strip():
        fail('数据目录仍被进程使用，请完全退出 Studio（包括开发进程和登录窗口）后重试。')
    if check.returncode not in (0, 1) or check.stderr.strip():
        fail('无法确认数据目录是否关闭，请检查路径和访问权限。')


def copy_profile(source, target):
    def ignored(directory, names):
        return [n for n in names if n in SKIP]
    # Ignore Chromium locks, but never follow other symlinks.
    for base, dirs, files in os.walk(source):
        dirs[:] = [d for d in dirs if d not in SKIP]
        for name in dirs + files:
            p = Path(base) / name
            if name not in SKIP and (p.is_symlink() or not (p.is_file() or p.is_dir())):
                fail('浏览器目录包含不支持的链接或特殊文件。')
    shutil.copytree(source, target, ignore=ignored)
    for base, dirs, files in os.walk(target):
        os.chmod(base, 0o700)
        for name in files:
            os.chmod(Path(base) / name, 0o600)


def write_catalog(root, data):
    path = root / CATALOG
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    os.chmod(path, 0o600)


def export_data(root, bundle):
    closed(root)
    data = read_catalog(root)
    if not data['accounts']:
        fail('此目录没有已保存账号。')
    if bundle.exists():
        fail('导出目录已存在，请换一个新目录。')
    bundle.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.studio-export-', dir=bundle.parent) as temp:
        staging = Path(temp) / 'bundle'
        staging.mkdir()
        for profile in profiles(data):
            relative = relative_profile(profile)
            if not (root / relative).is_dir() or (root / relative).is_symlink():
                fail('缺少账号浏览器环境，停止导出；请确认所选数据目录和版本。')
            copy_profile(root / relative, staging / relative)
        write_catalog(staging, data)
        (staging / 'manifest.json').write_text(json.dumps({'format': 1, 'platform': sys.platform}))
        closed(root)
        staging.rename(bundle)
    print(f'已导出 {len(data["accounts"])} 个账号至：{bundle}')
    print('此文件夹含网站登录凭证及账号浏览器存储，未加密。请用 AirDrop/自有加密磁盘传输，勿上传 Git、聊天或公开网盘。')


def import_data(root, bundle):
    closed(root)
    regular_tree(bundle)
    manifest = json.loads((bundle / 'manifest.json').read_text())
    if manifest != {'format': 1, 'platform': sys.platform}:
        fail('迁移包格式或操作系统不匹配。首版仅支持同系统迁移。')
    incoming = read_catalog(bundle)
    current = read_catalog(root) if (root / CATALOG).exists() else {
        'schemaVersion': 3, 'revision': 0, **{t: [] for t in TABLES}}
    for table in TABLES:
        existing = {r['id']: r for r in current[table]}
        for row in incoming[table]:
            if row['id'] in existing and existing[row['id']] != row:
                fail('账号资料 ID 冲突，未修改目标数据；请勿重复导入或覆盖已有账号。')
    occupied = {relative_profile(p) for p in profiles(current)}
    for profile in profiles(incoming):
        relative = relative_profile(profile)
        if relative in occupied or (root / relative).exists():
            fail('目标已存在同一登录环境，未修改任何数据。')
        if not (bundle / relative).is_dir():
            fail('迁移包缺少登录环境。')
    merged = dict(current)
    for table in TABLES:
        existing = {r['id'] for r in current[table]}
        additions = [dict(r) for r in incoming[table] if r['id'] not in existing]
        if table == 'accounts':
            for account in additions:
                account.pop('loginConfirmedAt', None)
        merged[table] = current[table] + additions
    merged['revision'] += 1
    if len(json.dumps(merged, ensure_ascii=False, indent=2).encode()) > 2 * 1024 * 1024:
        fail('合并后账号目录超过 Studio 大小限制。')
    # Stage all copying before changing the live catalog; preserve a permanent backup.
    with tempfile.TemporaryDirectory(prefix='.account-import-', dir=root) as temp:
        staging = Path(temp)
        for profile in profiles(incoming):
            relative = relative_profile(profile)
            copy_profile(bundle / relative, staging / relative)
        write_catalog(staging, merged)
        closed(root)
        backup = Path(tempfile.mkdtemp(prefix='account-migration-backup-', dir=root))
        for name in ('web-resources.json', 'web-resources.json.bak'):
            original = root / 'web-resources' / name
            if original.exists():
                shutil.copy2(original, backup / name)
        moved = []
        try:
            for profile in profiles(incoming):
                relative = relative_profile(profile)
                destination = root / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                (staging / relative).rename(destination)
                moved.append(destination)
            (root / CATALOG).parent.mkdir(parents=True, exist_ok=True)
            os.replace(staging / CATALOG, root / CATALOG)
        except BaseException:
            for destination in moved:
                shutil.rmtree(destination)
            raise
    print(f'已导入 {len(incoming["accounts"])} 个账号。原目录备份：{backup}')
    print('请启动 Studio，逐个打开账号核验身份与登录状态；文件导入成功不代表平台登录有效。')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['export', 'import'])
    parser.add_argument('bundle', type=Path, help='导出/导入的整个文件夹')
    parser.add_argument('--data-dir', type=Path, default=Path.home() / 'Library/Application Support/CCLink Studio')
    args = parser.parse_args()
    os.umask(0o077)
    root, bundle = args.data_dir.expanduser().resolve(), args.bundle.expanduser().resolve()
    if not root.is_dir():
        fail('找不到 Studio 数据目录；先启动一次 Studio，或用 --data-dir 指定。')
    if root == bundle or root in bundle.parents or bundle in root.parents:
        fail('迁移文件夹必须放在 Studio 数据目录之外。')
    # Verify ancestors on destination paths to avoid following profile-directory links.
    for path in (root / 'Partitions', root / 'web-resources', root / CATALOG):
        if path.is_symlink():
            fail('目标数据路径不能是符号链接。')
    (export_data if args.action == 'export' else import_data)(root, bundle)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(f'停止：{error}', file=sys.stderr)
        sys.exit(1)
