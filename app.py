import mimetypes

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")

from flask import Flask, render_template, request, Response, stream_with_context
from openai import OpenAI
import requests
import base64
import json
import re
import os
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Lock

try:
    from dotenv import load_dotenv
    from pathlib import Path

    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass

app = Flask(__name__)

AI_API_KEY = os.environ.get("AI_API_KEY")
AI_BASE_URL = os.environ.get(
    "AI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/"
)
MODEL = os.environ.get("AI_MODEL")
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")

if not AI_API_KEY:
    print("[DevShrink] WARNING: AI_API_KEY not set. Create a .env file with your key.")

client = OpenAI(base_url=AI_BASE_URL, api_key=AI_API_KEY or "pending")

HEADERS = {"Accept": "application/json"}
if GITHUB_TOKEN and "your_token" not in GITHUB_TOKEN:
    HEADERS["Authorization"] = f"token {GITHUB_TOKEN}"

ERROR_MAP = {
    404: "Repository not found. Check the URL and try again.",
    403: "This repository is private or GitHub rate limit was exceeded. Try adding a GITHUB_TOKEN.",
    401: "GitHub authentication failed. Check your GITHUB_TOKEN.",
    422: "Could not process this repository. It may be empty or corrupted.",
}

TIMEOUT = 20
MAX_TREE_ENTRIES = 20000


def parse_repo_url(url):
    url = url.strip().rstrip("/")
    match = re.search(r"github\.com/([^/]+)/([^/]+)", url)
    if not match:
        return None, None
    return match.group(1), match.group(2).replace(".git", "")


def sse(type, **data):
    payload = {"type": type, **data}
    return f"data: {json.dumps(payload)}\n\n"


def emit_pipeline(step, status):
    return sse("pipeline_step", step=step, status=status)


def emit_terminal(text, category="info"):
    return sse("terminal_line", text=text, category=category)


def fetch_repo_metadata(owner, repo):
    r = requests.get(
        f"https://api.github.com/repos/{owner}/{repo}", headers=HEADERS, timeout=TIMEOUT
    )
    if r.status_code != 200:
        return None, r.status_code
    return r.json(), 200


def fetch_languages(owner, repo):
    r = requests.get(
        f"https://api.github.com/repos/{owner}/{repo}/languages",
        headers=HEADERS,
        timeout=TIMEOUT,
    )
    if r.status_code != 200:
        return None
    return r.json()


def fetch_contributors(owner, repo):
    r = requests.get(
        f"https://api.github.com/repos/{owner}/{repo}/contributors?per_page=5",
        headers=HEADERS,
        timeout=TIMEOUT,
    )
    if r.status_code != 200:
        return None
    return r.json()


def fetch_tree(owner, repo, branch="HEAD"):
    url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1"
    r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    if r.status_code != 200:
        return None
    data = r.json()
    return data.get("tree", [])[:MAX_TREE_ENTRIES]


def fetch_file_content(owner, repo, path):
    url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}"
    r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    if r.status_code != 200:
        return None
    data = r.json()
    if data.get("encoding") == "base64":
        try:
            return base64.b64decode(data["content"]).decode("utf-8", errors="replace")
        except Exception:
            return None


IMPORTANT_FILES = [
    "readme.md",
    "readme.txt",
    "readme",
    "package.json",
    "requirements.txt",
    "pyproject.toml",
    "setup.py",
    "cargo.toml",
    "go.mod",
    "pom.xml",
    "build.gradle",
    "dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    ".env.example",
    "makefile",
    "main.py",
    "app.py",
    "index.js",
    "index.ts",
    "main.go",
    "main.rs",
    "server.js",
    "server.ts",
    "src/index.js",
    "src/main.ts",
]

SKIP_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".mp4",
    ".mp3",
    ".zip",
    ".lock",
    ".min.js",
    ".min.css",
    ".pdf",
    ".db",
    ".sqlite",
    ".wasm",
}

SKIP_DIRS = {
    "node_modules",
    ".git",
    "dist",
    "build",
    "__pycache__",
    ".next",
    "venv",
    "env",
    ".venv",
    "vendor",
    "coverage",
    ".cache",
    ".nuxt",
    ".output",
    "target",
    "bin",
    "obj",
}

SOURCE_EXTS = {
    ".py",
    ".js",
    ".ts",
    ".go",
    ".rs",
    ".java",
    ".rb",
    ".php",
    ".tsx",
    ".jsx",
    ".swift",
    ".kt",
    ".scala",
    ".c",
    ".cpp",
    ".h",
    ".hpp",
    ".cs",
    ".r",
    ".lua",
    ".sh",
    ".bash",
    ".zsh",
    ".ex",
    ".exs",
    ".elm",
    ".clj",
    ".cljs",
    ".hs",
    ".ml",
    ".mli",
}

CONFIG_EXTS = {
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".conf",
    ".xml",
    ".gradle",
    ".properties",
}

DOC_EXTS = {
    ".md",
    ".mdx",
    ".rst",
    ".txt",
    ".wiki",
}

SKIP_PRIMARY_LANGS = {"HTML", "CSS", "SCSS", "Less", "SVG"}

_request_log: dict[str, list[float]] = {}
_rate_lock = Lock()
RATE_LIMIT = 2
RATE_WINDOW = 60


def _check_rate_limit(ip: str) -> tuple[bool, int]:
    now = time.monotonic()
    with _rate_lock:
        timestamps = _request_log.get(ip, [])
        timestamps[:] = [t for t in timestamps if now - t < RATE_WINDOW]
        if len(timestamps) >= RATE_LIMIT:
            retry_after = int(RATE_WINDOW - (now - timestamps[0]))
            return False, max(retry_after, 1)
        timestamps.append(now)
        _request_log[ip] = timestamps
    return True, 0


ASSET_EXTS = {
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".styl",
}


def classify_file(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in SOURCE_EXTS:
        return "source"
    if ext in CONFIG_EXTS:
        return "config"
    if ext in DOC_EXTS:
        return "documentation"
    if ext in ASSET_EXTS:
        return "assets"
    return "other"


def is_ignored(path):
    parts = path.split("/")
    if any(p in SKIP_DIRS for p in parts):
        return True
    ext = os.path.splitext(path)[1].lower()
    if ext in SKIP_EXTENSIONS:
        return True
    return False


def compute_stats(tree):
    all_paths = [f["path"] for f in tree if f["type"] == "blob"]
    readable = [p for p in all_paths if not is_ignored(p)]

    total = len(all_paths)
    source_files = 0
    config_files = 0
    doc_files = 0
    asset_files = 0
    test_files = 0
    other_files = 0
    dirs = set()

    for p in readable:
        cat = classify_file(p)
        if cat == "source":
            source_files += 1
            base = os.path.basename(p).lower()
            if (
                base.startswith("test_")
                or base.startswith("_test")
                or base.endswith("_test")
                or base.endswith("_spec")
                or base.startswith("spec_")
            ):
                test_files += 1
        elif cat == "config":
            config_files += 1
        elif cat == "documentation":
            doc_files += 1
        elif cat == "assets":
            asset_files += 1
        else:
            other_files += 1

        parts = p.split("/")
        for i in range(1, len(parts)):
            dirs.add("/".join(parts[:i]))

    depths = [len(p.split("/")) for p in readable]
    avg_depth = round(sum(depths) / len(depths), 1) if depths else 0

    has_readme = any("readme" in p.lower() for p in all_paths)

    return {
        "total_files": total,
        "readable_files": len(readable),
        "source_files": source_files,
        "config_files": config_files,
        "doc_files": doc_files,
        "asset_files": asset_files,
        "test_files": test_files,
        "other_files": other_files,
        "directories": len(dirs),
        "avg_depth": avg_depth,
        "has_readme": has_readme,
    }


def pick_files_to_read(tree, owner, repo):
    all_paths = [f["path"] for f in tree if f["type"] == "blob"]
    readable = [p for p in all_paths if not is_ignored(p)]

    priority = []
    for imp in IMPORTANT_FILES:
        for p in readable:
            if p.lower() == imp or p.lower().endswith("/" + imp):
                priority.append(p)
                break

    source_files = [
        p for p in readable if classify_file(p) == "source" and p not in priority
    ]
    selected = list(dict.fromkeys(priority + source_files))[:10]
    return selected, readable


def build_context(owner, repo, tree, selected_files):
    file_tree_str = "\n".join(
        f["path"] for f in tree if f["type"] == "blob" and not is_ignored(f["path"])
    )[:12000]

    file_contents = []
    total_chars = 0
    for path in selected_files:
        content = fetch_file_content(owner, repo, path)
        if content:
            snippet = content[:12000]
            file_contents.append(f"### {path}\n```\n{snippet}\n```")
            total_chars += len(snippet)
        if total_chars > 60000:
            break

    return file_tree_str, "\n\n".join(file_contents)


SYSTEM_PROMPT = """You are DevShrink, an expert software architect and senior engineer with 15+ years of experience.

Your task: analyze a GitHub repository's file tree and key source files, then produce a precise onboarding report.

GROUND RULES (never violate these):
1. Every claim MUST be based on evidence in the provided file tree or file contents. If something is not visible in the data, say "could not be determined from the available files" — never guess.
2. Do NOT mention any database, authentication system, deployment method, cloud service, or third-party API unless you saw it explicitly referenced in the file tree or file contents.
3. Do NOT claim a programming language, framework, or library is used unless you saw it in a config file, import statement, or source file.
4. Be specific. "Uses Express with JWT middleware on /api/auth routes" is good. "Uses a web framework" is not. Reference actual file paths.
5. If the repository has tests (files in test/, __tests__/, *_test.go, *_spec.rb, etc.), reference them. If it has no visible tests, state that explicitly.
6. The architecture diagram (Mermaid) should show exactly what you observed, not what you imagine.

FOR MMERMAID DIAGRAMS:
- Include exactly one Mermaid diagram per report using ```mermaid fenced blocks.
- For web apps: client → server → DB/services flow
- For libraries/CLIs: module/component relationships
- For pipelines: data flow
- 5 to 9 nodes max. Label edges. Use graph LR for flows, graph TD for hierarchies.

OUTPUT STRUCTURE:
Use markdown with these exact section headers:

# [repo name]
_One sentence: what the code actually does, based on the files you saw._

## Executive Summary
2-3 tight sentences covering: the problem it solves, the core mechanism, and the developer experience.

## Repository Snapshot
Key metrics derived from the analysis.

## Architecture
Mermaid diagram plus 2-3 sentences explaining the flow.

## Quick Start
Exact shell commands to run locally. If setup cannot be determined, say so.

## Key Files
Exactly 4 files. For each: path in inline code, what it does, why it matters.

## Tech Stack
Language + version, framework, database/storage, key libraries, infrastructure. Only include items confirmed by the code.

## Code Quality Assessment
3-5 honest bullets: what's good, what's missing, any red flags, testing situation.

## Testing Status
What testing framework (if any), test coverage situation, what's tested vs not.

## Security Observations
Any security-relevant patterns observed (or note that none were detected).

## Risk Areas
Parts of the codebase that seem fragile, complex, or incomplete.

## Learning Order
Which files to read first, second, third — from easy to hard.

## First Contribution
One specific, scoped task with the file(s) to touch."""


def make_prompt(owner, repo, file_tree, file_contents):
    return f"""Repository: https://github.com/{owner}/{repo}

--- FILE TREE ---
{file_tree}

--- KEY FILE CONTENTS ---
{file_contents}

---

Produce a DevShrink Onboarding Report using the structure defined in the system prompt. Be specific, be honest, and only state what the code shows."""


def friendly_error(status_code):
    return ERROR_MAP.get(status_code, "An unexpected error occurred. Please try again.")


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/analyze", methods=["GET", "POST"])
def analyze():
    ip = request.remote_addr or "unknown"
    allowed, retry_after = _check_rate_limit(ip)
    if not allowed:

        def _rate_limit_stream():
            yield sse(
                "error", message=f"Rate limit exceeded. Try again in {retry_after}s."
            )
            yield sse("done", message="rate_limited")

        return Response(
            stream_with_context(_rate_limit_stream()),
            mimetype="text/event-stream",
            headers={"Retry-After": str(retry_after)},
        )

    if request.method == "GET":
        repo_url = request.args.get("url", "").strip()
    else:
        data = request.get_json()
        repo_url = data.get("url", "").strip()

    if not repo_url:
        return {"error": "No URL provided"}, 400

    owner, repo = parse_repo_url(repo_url)
    if not owner:
        return {"error": "Invalid GitHub URL"}, 400

    def generate():
        try:
            if not AI_API_KEY or AI_API_KEY == "pending":
                yield emit_terminal("API key not configured", "error")
                yield sse(
                    "error",
                    message="AI_API_KEY is not set. Create a .env file with your AI provider API key.",
                )
                return

            start_time = time.time()

            yield emit_terminal(f"Parsing repository URL: {repo_url}", "system")
            yield emit_pipeline("validating", "active")

            metadata_raw, status_code = fetch_repo_metadata(owner, repo)
            if metadata_raw is None:
                yield emit_pipeline("validating", "error")
                yield emit_terminal(
                    f"GitHub API returned status {status_code}", "error"
                )
                yield sse("error", message=friendly_error(status_code))
                return

            yield emit_pipeline("validating", "done")
            yield emit_terminal(f"Repository validated: {owner}/{repo}", "success")

            default_branch = metadata_raw.get("default_branch", "main")
            language = metadata_raw.get("language")
            topics = metadata_raw.get("topics", [])
            license_info = metadata_raw.get("license") or {}
            if license_info:
                license_name = (
                    license_info.get("spdx_id") or license_info.get("name") or "Custom"
                )
                if license_name == "Other":
                    license_name = "Custom"
            else:
                license_name = "Unknown"

            yield emit_pipeline("fetching", "active")
            yield emit_terminal(
                "Fetching repository metadata, languages, contributors...", "info"
            )

            with ThreadPoolExecutor(max_workers=3) as executor:
                futures = {
                    "languages": executor.submit(fetch_languages, owner, repo),
                    "contributors": executor.submit(fetch_contributors, owner, repo),
                }
                results = {}
                for name, future in futures.items():
                    try:
                        results[name] = future.result(timeout=15)
                    except Exception:
                        results[name] = None

            languages = results.get("languages") or {}
            contributors = results.get("contributors") or []

            if contributors:
                top = [c["login"] for c in contributors[:5]]
                yield emit_terminal(f"Top contributors: {', '.join(top)}", "info")

            primary_lang = language or "Unknown"
            if languages:
                sorted_langs = sorted(languages.items(), key=lambda x: -x[1])
                primary_lang = sorted_langs[0][0]
                for lang, _ in sorted_langs:
                    if lang not in SKIP_PRIMARY_LANGS:
                        primary_lang = lang
                        break

            yield sse(
                "repo_metadata",
                stars=metadata_raw.get("stargazers_count", 0),
                forks=metadata_raw.get("forks_count", 0),
                license=license_name,
                topics=topics,
                default_branch=default_branch,
                language=primary_lang,
                owner=owner,
                name=repo,
                contributors=[c["login"] for c in contributors[:5]]
                if contributors
                else [],
            )

            if languages:
                yield sse("languages", data=languages)
                lang_list = ", ".join(
                    sorted(languages.keys(), key=lambda k: languages[k], reverse=True)[
                        :5
                    ]
                )
                yield emit_terminal(f"Languages detected: {lang_list}", "success")
            else:
                yield emit_terminal(
                    "Could not fetch language data from GitHub API", "warn"
                )

            yield emit_pipeline("fetching", "done")
            yield emit_terminal(f"Default branch: {default_branch}", "info")

            yield emit_pipeline("tree", "active")
            yield emit_terminal("Downloading file tree...", "info")

            tree = fetch_tree(owner, repo, default_branch)

            if tree is None:
                yield emit_pipeline("tree", "error")
                yield emit_terminal("Failed to fetch file tree", "error")
                yield sse(
                    "error",
                    message="Could not fetch repository file tree. The repository may be too large.",
                )
                return

            yield emit_pipeline("tree", "done")
            yield emit_terminal(f"Found {len(tree):,} files in tree", "success")

            yield emit_pipeline("selecting", "active")
            yield emit_terminal("Analyzing file structure...", "info")

            stats = compute_stats(tree)
            stats["selected_files"] = 0
            yield sse("dashboard_data", data=stats)

            if stats["source_files"] > 0:
                yield emit_terminal(
                    f"{stats['source_files']} source files detected", "info"
                )
            if stats["test_files"] > 0:
                yield emit_terminal(
                    f"{stats['test_files']} test files found", "success"
                )
            else:
                yield emit_terminal("No test files detected", "warn")
            if stats["config_files"] > 0:
                yield emit_terminal(
                    f"{stats['config_files']} configuration files", "info"
                )
            if stats["doc_files"] > 0:
                yield emit_terminal(f"{stats['doc_files']} documentation files", "info")

            yield emit_pipeline("selecting", "done")

            yield emit_pipeline("reading", "active")
            yield emit_terminal(
                "Selecting high-signal files for AI analysis...", "info"
            )

            selected_files, _ = pick_files_to_read(tree, owner, repo)

            seed_count = len(selected_files)
            stats["selected_files"] = seed_count
            yield sse("dashboard_data", data={"selected_files": seed_count})
            yield emit_terminal(f"Selected {seed_count} high-signal files", "success")

            yield emit_terminal("Reading file contents...", "info")
            file_tree_str, file_contents = build_context(
                owner, repo, tree, selected_files
            )

            yield emit_pipeline("reading", "done")

            yield emit_pipeline("generating", "active")
            yield emit_terminal("Building AI analysis context...", "info")
            yield emit_terminal("Sending to AI model...", "info")

            prompt = make_prompt(owner, repo, file_tree_str, file_contents)

            elapsed = time.time() - start_time
            yield emit_terminal(
                f"Prepared in {elapsed:.1f}s — starting generation", "system"
            )

            stream = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                stream=True,
                temperature=0.3,
            )

            chunk_count = 0
            for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta.content
                if delta:
                    yield sse("chunk", text=delta)
                    chunk_count += 1
                    if chunk_count == 1:
                        yield emit_terminal("Receiving AI response...", "system")

            yield emit_pipeline("generating", "done")
            yield emit_terminal(
                f"Generation complete — {chunk_count} chunks received", "success"
            )
            yield sse("done")

        except requests.exceptions.ConnectionError:
            yield emit_terminal("Network error: cannot reach GitHub", "error")
            yield sse(
                "error",
                message="GitHub is currently unavailable. Check your connection.",
            )
        except requests.exceptions.Timeout:
            yield emit_terminal("Request timed out", "error")
            yield sse(
                "error",
                message="The request timed out. The repository may be too large.",
            )
        except Exception as e:
            yield emit_terminal(f"Internal error: {type(e).__name__}", "error")
            yield sse("error", message="Something went wrong. Please try again.")

    return Response(stream_with_context(generate()), mimetype="text/event-stream")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=False, port=port)
