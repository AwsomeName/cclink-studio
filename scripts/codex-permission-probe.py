#!/usr/bin/env python3
"""Inspect native Codex permissions without sending a model turn.

Run on the affected Mac with Python 3. Output contains only allowlisted policy facts.
Default: fresh ephemeral threads. --conversation-id reads saved metadata only.
--resume-conversation-id explicitly resumes the original session without a turn;
close Studio first. Native resume can refresh the session's stored configuration.
"""
import argparse
import json
import os
from pathlib import Path
import queue
import re
import signal
import subprocess
import threading


class ProbeError(Exception):
    pass


def label(value, allowed):
    if value is None:
        return "missing"
    return value if isinstance(value, str) and value in allowed else "other"


def boolean(value):
    return value if isinstance(value, bool) else "missing-or-invalid"


def policy(result, workspace=None):
    sandbox = result.get("sandbox")
    sandbox = sandbox if isinstance(sandbox, dict) else {}
    roots = sandbox.get("writableRoots")
    result = {
        "modelProvider": label(result.get("modelProvider"), ["openai"]),
        "approvalPolicy": label(result.get("approvalPolicy"), ["untrusted", "on-failure", "on-request", "never"]),
        "approvalsReviewer": label(result.get("approvalsReviewer"), ["user", "guardian"]),
        "sandbox.type": label(sandbox.get("type"), ["workspaceWrite", "readOnly", "dangerFullAccess", "externalSandbox"]),
        "sandbox.networkAccess": boolean(sandbox.get("networkAccess")),
        "sandbox.writableRootsCount": len(roots) if isinstance(roots, list) else "missing-or-invalid",
        "sandbox.excludeTmpdirEnvVar": boolean(sandbox.get("excludeTmpdirEnvVar")),
        "sandbox.excludeSlashTmp": boolean(sandbox.get("excludeSlashTmp")),
    }
    if workspace is not None and isinstance(roots, list):
        valid = [Path(root).expanduser().resolve() for root in roots if isinstance(root, str)]
        result["sandbox.writableRootsMatchingWorkspace"] = sum(root == workspace for root in valid)
        result["sandbox.writableRootsOtherThanWorkspace"] = sum(root != workspace for root in valid)
    return result


def session_reference(workspace, conversation_id):
    references = set()
    for path in (workspace / ".cclink-studio/state").glob("*.json"):
        try:
            data = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        snapshot = data.get("snapshot", {})
        conversations = snapshot.get("sections", {}).get("agentConversations", {}).get("conversations", {})
        conversation = conversations.get(conversation_id, {})
        session_id = conversation.get("sessionId")
        if isinstance(session_id, str) and re.fullmatch(r"[0-9a-fA-F-]{36}", session_id):
            references.add(session_id)
    if len(references) != 1:
        raise ProbeError("saved-session-reference-missing-or-ambiguous")
    return references.pop()


def saved_roots(workspace, conversation_id):
    """Read the selected Studio session reference and its native metadata only."""
    session_id = session_reference(workspace, conversation_id)
    home = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex").expanduser()
    report = {"scope": "saved session metadata only; no process launch; no changes", "records": []}
    for location in ["sessions", "archived_sessions"]:
        for path in (home / location).rglob("*" + session_id + ".jsonl*"):
            if path.suffix != ".jsonl":
                report["records"].append({"location": location, "compressed": True})
                continue
            with path.open() as stream:
                line = stream.readline(2 * 1024 * 1024)
            data = json.loads(line)
            if data.get("type") != "session_meta":
                raise ProbeError("native-metadata-format-unsupported")
            metadata = data.get("payload", {})
            roots = metadata.get("runtime_workspace_roots")
            roots = roots if isinstance(roots, list) else []
            valid = [Path(root).expanduser().resolve() for root in roots if isinstance(root, str)]
            report["records"].append({
                "location": location,
                "runtimeWorkspaceRootsCount": len(roots),
                "rootsMatchingCurrentWorkspace": sum(root == workspace for root in valid),
                "rootsOtherThanCurrentWorkspace": sum(root != workspace for root in valid),
                "invalidRootCount": len(roots) - len(valid),
                "storedCwdMatchesCurrentWorkspace": isinstance(metadata.get("cwd"), str) and Path(metadata["cwd"]).resolve() == workspace,
            })
    print(json.dumps(report, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, default=Path.home() / "Desktop/air-app")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--conversation-id", help="Only inspect saved root metadata; no Codex process")
    mode.add_argument("--resume-conversation-id", help="Resume the original session without a model turn; close Studio first; native session config may refresh")
    args = parser.parse_args()
    cwd = args.workspace.expanduser().resolve()
    if args.conversation_id:
        saved_roots(cwd, args.conversation_id)
        return
    session_id = session_reference(cwd, args.resume_conversation_id) if args.resume_conversation_id else None
    exe = Path("/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex")
    if not cwd.is_dir() or not exe.is_file():
        raise ProbeError("workspace-or-diagnostic-executable-not-found")
    env = dict(os.environ)
    for key in list(env):
        if re.match(r"^(ANTHROPIC_|CLAUDE_|CCLINK_|ELECTRON_|CODEX_INTERNAL_|CODEX_THREAD)", key) or key in ["CLAUDECODE", "OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL"]:
            del env[key]
    exclusions = ",".join(filter(None, [env.get("NO_PROXY"), env.get("no_proxy"), "127.0.0.1,localhost,::1"]))
    env["NO_PROXY"] = env["no_proxy"] = exclusions
    version = subprocess.run([str(exe), "--version"], capture_output=True, text=True, timeout=10, env=env)
    match = re.search(r"codex-cli ([0-9][0-9A-Za-z.+-]{0,80})", version.stdout)
    report = {"version": match.group(1) if match else "unknown", "customCodexHome": bool(env.get("CODEX_HOME")), "scope": "fresh ephemeral threads only; no model turn; no old-thread resume"}
    if session_id:
        report["scope"] = "original thread/resume; no turn/start; native session configuration may refresh; inherited MCP disabled"
    command = [str(exe), "app-server", "--listen", "stdio://"]
    for setting in ['cli_auth_credentials_store="file"', 'mcp_oauth_credentials_store="file"', 'analytics.enabled=false']:
        command += ["-c", setting]
    for feature in ["apps", "plugins", "hooks", "multi_agent", "multi_agent_v2", "browser_use", "computer_use", "in_app_browser", "in_app_local_automation", "skill_mcp_dependency_install"]:
        command += ["-c", "features." + feature + "=false"]
    child = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, start_new_session=True)
    lines = queue.Queue()

    def read_lines():
        try:
            for line in child.stdout:
                lines.put(line)
        finally:
            lines.put(None)

    threading.Thread(target=read_lines, daemon=True).start()
    sequence = 0

    def request(method, params):
        nonlocal sequence
        sequence += 1
        child.stdin.write(json.dumps({"id": sequence, "method": method, "params": params}) + "\n")
        child.stdin.flush()
        # Bound the entire request, even if the server continually emits notifications.
        import time
        deadline = time.monotonic() + 30
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ProbeError(method + ":timeout")
            try:
                line = lines.get(timeout=remaining)
            except queue.Empty:
                raise ProbeError(method + ":timeout") from None
            if line is None:
                raise ProbeError(method + ":process-exited")
            try:
                message = json.loads(line)
            except ValueError:
                continue
            if not isinstance(message, dict) or message.get("id") != sequence or "method" in message:
                continue
            if "error" in message:
                code = message["error"].get("code")
                raise ProbeError(method + ":RPC_" + (str(code) if type(code) is int else "unknown"))
            return message.get("result", {})

    try:
        request("initialize", {"clientInfo": {"name": "cclink_studio", "title": "CCLink Studio", "version": "1"}})
        child.stdin.write('{"method":"initialized","params":{}}\n')
        child.stdin.flush()
        loaded = request("config/read", {"cwd": str(cwd), "includeLayers": False})
        inherited = loaded.get("config", {}).get("mcp_servers") or {}
        disabled = {}
        for name, value in inherited.items():
            if isinstance(value, dict):
                disabled[name] = {"enabled": False, **({"url": value["url"]} if isinstance(value.get("url"), str) else {"command": value.get("command") or "studio-disabled-mcp"})}
        # The reported Studio run used scope=all, permissionMode=auto and native tools.
        # Reproduce its workspace-write resume once, without changing it to read-only.
        for mode in (["workspace-write"] if session_id else ["workspace-write", "read-only"]):
            config = {
                "mcp_servers": disabled,
                "features.shell_tool": mode == "workspace-write",
                "features.unified_exec": mode == "workspace-write",
                "web_search": "disabled",
                "sandbox_workspace_write.network_access": False,
                "sandbox_workspace_write.writable_roots": [],
                "sandbox_workspace_write.exclude_tmpdir_env_var": True,
                "sandbox_workspace_write.exclude_slash_tmp": True,
            }
            try:
                params = {"cwd": str(cwd), "modelProvider": "openai", "approvalPolicy": "untrusted", "approvalsReviewer": "user", "sandbox": mode, "config": config}
                params.update({"threadId": session_id, "excludeTurns": True} if session_id else {"ephemeral": True})
                result = request("thread/resume" if session_id else "thread/start", params)
                report[mode] = policy(result, cwd)
                if session_id:
                    report["sameNativeSession"] = result.get("thread", {}).get("id") == session_id
            except ProbeError as error:
                report[mode] = {"error": str(error)}
    finally:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=3)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except ProbeError as error:
        print(json.dumps({"probeError": str(error)}))
        raise SystemExit(1)
    except Exception as error:
        # Do not echo paths, configuration values, or provider error payloads.
        print(json.dumps({"probeErrorType": type(error).__name__}))
        raise SystemExit(1)
