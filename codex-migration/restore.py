import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import tempfile
from pathlib import Path


def save_new(source, target):
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=target.parent) as staged:
        with source.open('rb') as original:
            shutil.copyfileobj(original, staged)
        staged.flush()
        os.link(staged.name, target)


def present(home, relative, thread_id):
    for base in [home / 'sessions' / relative, home / 'archived_sessions' / relative.name]:
        if base.exists() or base.with_suffix('.jsonl.zst').exists():
            return True
    for database in home.glob('state_*.sqlite'):
        with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as connection:
            if connection.execute('select 1 from threads where id=?', (thread_id,)).fetchone():
                return True
    return False


def visible_text(record):
    if record['type'] != 'event_msg':
        return None
    event = record['payload']
    if event.get('type') in ('user_message', 'agent_message'):
        return ('用户' if event['type'] == 'user_message' else '助手', event.get('message', ''))
    item = event.get('item', {})
    if event.get('type') != 'item_completed' or item.get('type') not in ('UserMessage', 'AgentMessage'):
        return None
    text = '\n'.join(part.get('text') or '[非文本内容]' for part in item.get('content', []))
    return ('用户' if item['type'] == 'UserMessage' else '助手', text)


def restore(packet, key, home, notes, project):
    with tempfile.TemporaryDirectory() as directory:
        stage = Path(directory)
        subprocess.run(['age', '-d', '-i', key, '-o', stage / 'packed', packet], check=True)
        subprocess.run(['zstd', '-qd', '--long=29', stage / 'packed', '-o', stage / 'unpacked'], check=True)
        digest = hashlib.sha256()
        with (stage / 'unpacked').open('rb') as original, (stage / 'native').open('wb') as native, (stage / 'chat').open('w', encoding='utf-8') as chat:
            meta = json.loads(original.readline())
            thread_id = meta['id']
            relative = Path(meta['path'])
            if thread_id != packet.stem or not re.fullmatch(r'\d{4}/\d{2}/\d{2}/rollout-[\dT:-]+-' + re.escape(thread_id) + r'\.jsonl', relative.as_posix()):
                raise ValueError('Unexpected backup identity or rollout path')
            chat.write(f"# {meta['title']}\n\n`{thread_id}`\n")
            for index, line in enumerate(original):
                digest.update(line)
                record = json.loads(line)
                payload = record['payload']
                if index == 0:
                    if record['type'] != 'session_meta' or payload['id'] != thread_id:
                        raise ValueError('Unexpected session metadata')
                    previous_project = payload['cwd']
                settings = None
                if record['type'] in ('session_meta', 'turn_context'):
                    settings = payload
                elif record['type'] == 'event_msg' and payload.get('type') == 'thread_settings_applied':
                    settings = payload.get('thread_settings')
                elif record['type'] == 'world_state':
                    settings = payload.get('state', {}).get('environments', {}).get('environments', {}).get('local')
                if isinstance(settings, dict) and settings.get('cwd') == previous_project:
                    settings['cwd'] = str(project)
                    if 'runtime_workspace_roots' in settings:
                        settings['runtime_workspace_roots'] = [str(project)]
                    line = json.dumps(record, ensure_ascii=False).encode('utf-8') + b'\n'
                native.write(line)
                message = visible_text(record)
                if message:
                    chat.write(f'\n## {message[0]}\n\n{message[1]}\n')
        if digest.hexdigest() != meta['sha256']:
            raise ValueError('Original rollout SHA-256 mismatch')
        note = notes / (thread_id + '.md')
        if not note.exists():
            save_new(stage / 'chat', note)
        if present(home, relative, thread_id):
            print(f'已存在，跳过原生会话：{thread_id}')
        else:
            save_new(stage / 'native', home / 'sessions' / relative)
            print(f'已恢复：{thread_id}  {meta["title"]}')
            return thread_id, home / 'sessions' / relative, meta['title']


def index_new(codex, sessions, home, project):
    server = subprocess.Popen([codex, 'app-server', '--listen', 'stdio://'], cwd=project,
                              env={**os.environ, 'CODEX_HOME': str(home)}, stdin=subprocess.PIPE,
                              stdout=subprocess.PIPE, text=True)

    def request(method, params):
        server.stdin.write(json.dumps({'id': 1, 'method': method, 'params': params}) + '\n')
        server.stdin.flush()
        for line in server.stdout:
            response = json.loads(line)
            if response.get('id') == 1:
                if 'error' in response:
                    raise RuntimeError(f'{method}: {response["error"]}')
                return response['result']
        raise RuntimeError(f'Codex 在 {method} 时断开。')

    try:
        request('initialize', {'clientInfo': {'name': 'session_migration', 'version': '1'}, 'capabilities': {'experimentalApi': True}})
        server.stdin.write('{"method":"initialized"}\n')
        for thread_id, path, title in sessions:
            thread = request('thread/resume', {'threadId': thread_id, 'path': str(path), 'cwd': str(project), 'excludeTurns': True})['thread']
            if thread['id'] != thread_id or Path(thread['cwd']).resolve() != project:
                raise RuntimeError(f'Codex 恢复到了不同的会话或项目：{thread_id}')
            if not request('thread/turns/list', {'threadId': thread_id, 'limit': 1})['data']:
                raise RuntimeError(f'Codex 未读到历史轮次：{thread_id}')
            if title:
                request('thread/name/set', {'threadId': thread_id, 'name': title})
            request('thread/unsubscribe', {'threadId': thread_id})
            print(f'Codex 已读回：{thread_id}')
    finally:
        server.terminate()
        server.wait()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='解密并恢复 CCLink Studio 的 Codex 会话，不覆盖已有对话。')
    parser.add_argument('key', type=Path)
    parser.add_argument('--codex-home', type=Path, default=Path(os.getenv('CODEX_HOME') or Path.home() / '.codex'))
    parser.add_argument('--notes', type=Path, default=Path.home() / 'CCLink-Restored-Chats')
    args = parser.parse_args()
    os.umask(0o077)
    folder = Path(__file__).resolve().parent
    packets = sorted((folder / 'sessions').glob('*.age'))
    if len(packets) != 31:
        parser.error(f'应有 31 条会话，实际找到 {len(packets)} 条。请检查仓库是否下载完整。')
    codex = shutil.which('codex')
    bundled = Path('/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex')
    if not codex and bundled.is_file():
        codex = str(bundled)
    if not codex or not all(shutil.which(tool) for tool in ('age', 'zstd')):
        parser.error('请先安装 Codex、age 和 zstd。')
    home = args.codex_home.expanduser().resolve()
    sessions = []
    for packet in packets:
        result = restore(packet, args.key.expanduser(), home, args.notes.expanduser(), folder.parent)
        if result:
            sessions.append(result)
    if sessions:
        index_new(codex, sessions, home, folder.parent)
