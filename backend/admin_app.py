"""
NeuroAccess 管理后台 — 轻量 FastAPI 应用
子域名: admin.neuroaccess.cloud → port 8002
复用同一 neuroaccess.db + feedback.log + survey.log
"""

import os, sys, json
from datetime import datetime, timedelta
from typing import Optional, Dict

from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from jose import jwt, JWTError
from dotenv import load_dotenv
import sqlite3
import time as _time
import collections as _collections
import urllib.parse as _urllib_parse

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
AUDIT_LOG = os.path.join(BASE_DIR, "admin_audit.log")

# 登录失败计数：ip -> [失败次数, 首次失败时间戳]
_LOGIN_FAILS: Dict[str, list] = {}
LOGIN_MAX_FAILS = 5
LOGIN_LOCK_SECONDS = 600


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for") or request.headers.get("x-real-ip") or ""
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def audit(action: str, request: Request, detail: str = "") -> None:
    """追加审计日志（登录、查看用户详情等敏感动作）。"""
    try:
        line = json.dumps({
            "ts": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "ip": _client_ip(request),
            "ua": (request.headers.get("user-agent") or "")[:120],
            "action": action,
            "detail": detail,
        }, ensure_ascii=False)
        with open(AUDIT_LOG, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except Exception:
        pass


def _login_blocked(ip: str) -> int:
    """返回剩余锁定秒数，0 表示未锁定。"""
    rec = _LOGIN_FAILS.get(ip)
    if not rec:
        return 0
    cnt, first = rec
    if cnt < LOGIN_MAX_FAILS:
        return 0
    remain = int(LOGIN_LOCK_SECONDS - (_time.time() - first))
    if remain <= 0:
        _LOGIN_FAILS.pop(ip, None)
        return 0
    return remain


def _login_failed(ip: str) -> None:
    rec = _LOGIN_FAILS.get(ip)
    if not rec or _time.time() - rec[1] > LOGIN_LOCK_SECONDS:
        _LOGIN_FAILS[ip] = [1, _time.time()]
    else:
        rec[0] += 1

DB_PATH = os.path.join(BASE_DIR, "neuroaccess.db")
SURVEY_LOG = os.path.join(BASE_DIR, "survey.log")
FEEDBACK_LOG = os.path.join(BASE_DIR, "feedback.log")
ADMIN_FRONTEND = os.path.join(BASE_DIR, "admin", "index.html")

# ── Admin 凭证 ──
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "neuroaccess_admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")
if not ADMIN_PASSWORD:
    ADMIN_PASSWORD = "NeuroAccessAdmin2026!"

ADMIN_JWT_SECRET = os.getenv("ADMIN_JWT_SECRET")
if not ADMIN_JWT_SECRET:
    import secrets
    ADMIN_JWT_SECRET = secrets.token_urlsafe(48)

app = FastAPI(title="NeuroAccess Admin Panel")

# 同源部署（admin.neuroaccess.cloud → 127.0.0.1:8002），CORS 只需放行自家域名。
# 原来的 allow_origins=["*"] + allow_credentials=True 是无效组合：浏览器会直接拒绝，
# 等于没配；改成明确白名单后行为可预期，也不会给任意站点开凭证通道。
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://admin.neuroaccess.cloud",
        "https://neuroaccess.cloud",
        "https://www.neuroaccess.cloud",
        "http://localhost:8002",
        "http://127.0.0.1:8002",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# =====================================================================
# 安全防火墙（应用层）— 只拦明确恶意/高频请求，不改任何现有功能
# 开关：环境变量 ADMIN_FIREWALL_ENABLED=0 可一键关闭（默认开启）
# =====================================================================

_ADMIN_FW_ENABLED = os.environ.get("ADMIN_FIREWALL_ENABLED", "1") == "1"

# 每 IP 限流（max_requests, window_seconds）
_ADMIN_FW_RATE = {
    "login":   (5, 60),     # 管理登录：防爆破（配合 Turnstile）
    "api":     (120, 60),   # 管理 API：dashboard/users/feedback/survey
    "default": (300, 60),   # 前端 SPA 页面加载
}
_ADMIN_FW_HITS: dict = {}
_ADMIN_FW_CLEANUP = 0

# 恶意/扫描器路径特征
_ADMIN_FW_BAD_PATH_MARKERS = (
    "/.env", "/.git/", "/.svn/", "/.aws/", "/.ssh/",
    "/wp-admin", "/wp-login.php", "/wp-content", "/wp-includes",
    "/phpmyadmin", "/pma/", "/adminer", "/manager/html", "/actuator",
    "/console", "/jenkins", "/solr/", "/web.config", "/server-status",
    "/server-info", "/etc/passwd", "/proc/self/", "/cgi-bin/", "/shell",
    "/webshell", "/cmd.php", "/shell.php", "/config.php", "/info.php",
    "/test.php", "/dump.sql", "/backup.zip", "/.htaccess", "/.bash_history",
    "/laravel", "/thinkphp", "/v1/", "/swagger", "/graphql",
)
# 查询串注入/XSS 特征（只查 URL 与查询参数）
_ADMIN_FW_BAD_QUERY_PATTERNS = (
    "union select", "union+select", "union%20select", "union all select",
    "or 1=1", "or+1=1", "or 1=1--", "' or '", "select * from",
    "select+*+from", "drop table", "delete from", "insert into", "update set",
    "xp_cmdshell", "information_schema", "load_file", "into outfile",
    "benchmark(", "sleep(", "pg_sleep", "waitfor delay",
    "javascript:", "onerror=", "onload=", "onclick=", "<script", "</script>",
    "alert(", "document.cookie", "confirm(", "prompt(", "svg onload",
    "base64_decode", "eval(", "assert(", "system(", "passthru(", "shell_exec",
)
# 明确恶意扫描器 UA（不误伤合法客户端）
_ADMIN_FW_BAD_UA = (
    "sqlmap", "nikto", "nmap", "masscan", "gobuster", "dirb", "wfuzz",
    "acunetix", "nessus", "openvas", "burpsuite", "hydra", "medusa",
    "python-urllib", "libwww-perl", "zgrab", "expanse", "censys",
    "nuclei", "xray", "l9explore", "fimap", "shelldump",
    "w3af", "wpscan", "joomscan", "aircrack", "metasploit",
)

def _admin_fw_client_ip(request: Request) -> str:
    cf = request.headers.get("cf-connecting-ip") or ""
    if cf:
        return cf.strip().split(",")[0][:64]
    xff = request.headers.get("x-forwarded-for") or ""
    if xff:
        return xff.strip().split(",")[0][:64]
    if request.client:
        return (request.client.host or "0.0.0.0")[:64]
    return "0.0.0.0"

def _admin_fw_group(path: str) -> str:
    if path == "/api/admin/login":
        return "login"
    if path.startswith("/api/admin/"):
        return "api"
    return "default"

def _admin_fw_rate_ok(ip: str, group: str, now: float) -> bool:
    limit, window = _ADMIN_FW_RATE[group]
    key = group + "|" + ip
    dq = _ADMIN_FW_HITS.get(key)
    if dq is None:
        dq = _collections.deque()
        _ADMIN_FW_HITS[key] = dq
    while dq and now - dq[0] > window:
        dq.popleft()
    if len(dq) >= limit:
        return False
    dq.append(now)
    return True

def _admin_fw_cleanup(now: float):
    global _ADMIN_FW_CLEANUP
    _ADMIN_FW_CLEANUP += 1
    if _ADMIN_FW_CLEANUP % 200 != 0 and len(_ADMIN_FW_HITS) < 20000:
        return
    stale = [k for k, dq in _ADMIN_FW_HITS.items() if not dq or now - dq[-1] > 3600]
    for k in stale:
        del _ADMIN_FW_HITS[k]

@app.middleware("http")
async def admin_security_firewall(request: Request, call_next):
    """后台防火墙主入口：命中即 403/429/405/413，其余原样放行。"""
    if not _ADMIN_FW_ENABLED:
        return await call_next(request)
    now = _time.time()
    path = request.url.path
    # 1) 危险 HTTP 方法
    if request.method in ("TRACE", "CONNECT", "TRACK"):
        return JSONResponse(status_code=405, content={"detail": "请求方法不允许"})
    # 2) 恶意路径/路径穿越/空字节
    raw_lower = path.lower()
    try:
        decoded_lower = _urllib_parse.unquote(path).lower()
    except Exception:
        decoded_lower = raw_lower
    if any(m in raw_lower or m in decoded_lower for m in _ADMIN_FW_BAD_PATH_MARKERS):
        return JSONResponse(status_code=403, content={"detail": "请求被防火墙拦截"})
    if "/../" in decoded_lower or "/..%2f" in raw_lower or "%2e%2e" in raw_lower or "%00" in raw_lower or "\x00" in decoded_lower:
        return JSONResponse(status_code=403, content={"detail": "请求被防火墙拦截"})
    # 3) 查询串注入/XSS 特征（先 URL 解码，再匹配）
    try:
        q = _urllib_parse.unquote(request.url.query).lower().replace("+", " ")
    except Exception:
        q = request.url.query.lower()
    if any(p in q for p in _ADMIN_FW_BAD_QUERY_PATTERNS) or "\x00" in q or "\r" in q or "\n" in q:
        return JSONResponse(status_code=403, content={"detail": "请求被防火墙拦截"})
    # 4) 恶意扫描器 UA
    ua = (request.headers.get("user-agent") or "").lower()
    if any(b in ua for b in _ADMIN_FW_BAD_UA):
        return JSONResponse(status_code=403, content={"detail": "请求被防火墙拦截"})
    # 5) 请求体大小护栏
    cl = request.headers.get("content-length")
    if cl and cl.isdigit():
        size = int(cl)
        ct = (request.headers.get("content-type") or "").lower()
        if "multipart" in ct:
            if size > 260 * 1024 * 1024:
                return JSONResponse(status_code=413, content={"detail": "文件过大"})
        elif size > 20 * 1024 * 1024:
            return JSONResponse(status_code=413, content={"detail": "请求体过大"})
    # 6) 健康检查与 CORS 预检免限流
    if path in ("/", "/api/health", "/health") or request.method == "OPTIONS":
        return await call_next(request)
    # 7) 限流
    ip = _admin_fw_client_ip(request)
    if not _admin_fw_rate_ok(ip, _admin_fw_group(path), now):
        return JSONResponse(status_code=429, content={"detail": "请求过于频繁，请稍后再试"})
    _admin_fw_cleanup(now)
    return await call_next(request)

# ── Turnstile 人机验证 ──
# ── 自建人机验证（与 backend/app.py 同逻辑，支持 'cid:answer'）──
# ── Turnstile 人机验证 ──
TURNSTILE_SECRET_KEY = os.environ.get("TURNSTILE_SECRET_KEY", "")

def verify_turnstile(token):
    """验证 Cloudflare Turnstile 令牌。无令牌直接失败；未配置密钥时放行（开发环境）。"""
    if not TURNSTILE_SECRET_KEY:
        return True
    if not token:
        return False
    import urllib.request, urllib.parse
    try:
        data = urllib.parse.urlencode({"secret": TURNSTILE_SECRET_KEY, "response": token}).encode()
        req = urllib.request.Request("https://challenges.cloudflare.com/turnstile/v0/siteverify", data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            return bool(json.loads(resp.read().decode()).get("success", False))
    except Exception:
        return False

# ── DB ──

def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    # 后台只读为主，但主站随时可能在写同一份库；不设 busy_timeout 时
    # 一旦撞上写锁会立刻抛 "database is locked"，页面表现为空白/报错。
    conn.execute("PRAGMA busy_timeout=5000")
    return conn

# ── JWT ──

def create_admin_token(username: str) -> str:
    payload = {
        "sub": username,
        "exp": datetime.utcnow() + timedelta(hours=8),
        "iat": datetime.utcnow(),
        "role": "admin",
    }
    return jwt.encode(payload, ADMIN_JWT_SECRET, algorithm="HS256")

def verify_admin_token(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, ADMIN_JWT_SECRET, algorithms=["HS256"])
        if payload.get("role") != "admin":
            return None
        return payload.get("sub")
    except JWTError:
        return None

async def require_admin(request: Request):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未授权，请先登录")
    token = auth.split(" ", 1)[1]
    user = verify_admin_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="登录已过期")
    return user

# ── API Routes ──

@app.post("/api/admin/login")
async def admin_login(request: Request):
    """Admin 登录（Turnstile 人机验证）"""
    data = await request.json()
    username = data.get("username", "")
    password = data.get("password", "")
    cf_token = data.get("cf_turnstile_response", "")

    ip = _client_ip(request)
    remain = _login_blocked(ip)
    if remain > 0:
        audit("login_locked", request, f"剩余{remain}s")
        raise HTTPException(status_code=429, detail=f"登录尝试过多，请 {remain} 秒后再试")

    if username != ADMIN_USERNAME or password != ADMIN_PASSWORD:
        _login_failed(ip)
        audit("login_fail", request, f"user={username[:40]}")
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    if not verify_turnstile(cf_token):
        _login_failed(ip)
        audit("login_captcha_fail", request, f"user={username[:40]}")
        raise HTTPException(status_code=401, detail="请完成人机验证")

    _LOGIN_FAILS.pop(ip, None)
    audit("login_ok", request, f"user={username}")
    token = create_admin_token(username)
    return {"success": True, "token": token, "username": username}


@app.get("/api/health")
def admin_health():
    """轻量健康检查（防火墙已对该路径免限流）。不查库，只证明进程能响应。"""
    return {"ok": True, "service": "neuroaccess-admin", "ts": int(_time.time())}


@app.get("/api/admin/dashboard")
def admin_dashboard(_=Depends(require_admin)):
    """Dashboard 统计概览"""
    conn = get_db()
    try:
        total_users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        real_users = conn.execute("SELECT COUNT(*) FROM users WHERE is_test=0").fetchone()[0]
        test_users = total_users - real_users
        today_reg = conn.execute(
            "SELECT COUNT(*) FROM users WHERE date(created_at) = date('now', 'localtime')"
        ).fetchone()[0]
        total_reports = conn.execute("SELECT COUNT(*) FROM reports").fetchone()[0]
        survey_done = conn.execute(
            "SELECT COUNT(*) FROM users WHERE survey_completed=1"
        ).fetchone()[0]
        vc_count = conn.execute("SELECT COUNT(*) FROM verification_codes").fetchone()[0]

        feedback_cnt = 0
        if os.path.exists(FEEDBACK_LOG):
            with open(FEEDBACK_LOG, "r") as f:
                feedback_cnt = f.read().count("\n=== ")
        
        survey_cnt = 0
        if os.path.exists(SURVEY_LOG):
            with open(SURVEY_LOG, "r") as f:
                for line in f:
                    if line.strip():
                        survey_cnt += 1

        return {
            "totalUsers": total_users,
            "realUsers": real_users,
            "testUsers": test_users,
            "todayRegistered": today_reg,
            "totalReports": total_reports,
            "surveyCompleted": survey_done,
            "surveySubmissions": survey_cnt,
            "feedbackCount": max(0, feedback_cnt),
            "verificationCodes": vc_count,
        }
    finally:
        conn.close()


@app.get("/api/admin/users")
def admin_users(
    page: int = 1,
    limit: int = 20,
    search: str = "",
    filter: str = "all",
    _=Depends(require_admin),
):
    conn = get_db()
    try:
        # 上限护栏：limit 是查询参数，不夹紧的话一次请求就能让 SQLite 扫全表
        page = max(1, page)
        limit = max(1, min(limit, 100))
        offset = (page - 1) * limit
        where_real = "AND is_test=0"
        if filter == "test":
            where_real = "AND is_test=1"
        elif filter == "all":
            where_real = ""

        if search:
            rows = conn.execute(
                f"""SELECT id, username, email, created_at, avatar_color,
                          terms_accepted, survey_completed, is_test
                   FROM users
                   WHERE (username LIKE ? OR email LIKE ?) {where_real}
                   ORDER BY id DESC LIMIT ? OFFSET ?""",
                (f"%{search}%", f"%{search}%", limit, offset),
            ).fetchall()
            total = conn.execute(
                f"SELECT COUNT(*) FROM users WHERE (username LIKE ? OR email LIKE ?) {where_real}",
                (f"%{search}%", f"%{search}%"),
            ).fetchone()[0]
        else:
            rows = conn.execute(
                f"""SELECT id, username, email, created_at, avatar_color,
                          terms_accepted, survey_completed, is_test
                   FROM users
                   WHERE 1=1 {where_real}
                   ORDER BY id DESC LIMIT ? OFFSET ?""",
                (limit, offset),
            ).fetchall()
            total = conn.execute(
                f"SELECT COUNT(*) FROM users WHERE 1=1 {where_real}"
            ).fetchone()[0]

        users = []
        for r in rows:
            u = dict(r)
            u["created_at"] = str(u["created_at"]) if u["created_at"] else ""
            users.append(u)

        return {"total": total, "page": page, "limit": limit, "users": users}
    finally:
        conn.close()


@app.get("/api/admin/users/{user_id}")
def admin_user_detail(user_id: int, request: Request, _=Depends(require_admin)):
    audit("view_user", request, f"user_id={user_id}")
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="用户不存在")
        user = dict(row)
        user["created_at"] = str(user["created_at"]) if user.get("created_at") else ""
        user["report_count"] = conn.execute(
            "SELECT COUNT(*) FROM reports WHERE user_id=?", (user_id,)
        ).fetchone()[0]
        return user
    finally:
        conn.close()


@app.get("/api/admin/feedback")
def admin_feedback(_=Depends(require_admin)):
    entries = []

    # 1) 数据库永久存储（主来源）
    try:
        from auth import get_db
        conn = get_db()
        rows = conn.execute(
            "SELECT id, user_id, name, email, type, rating, message, created_at FROM feedback ORDER BY id DESC LIMIT 500"
        ).fetchall()
        conn.close()
        for r in rows:
            entries.append({
                "id": r[0],
                "user_id": r[1],
                "name": r[2] or "",
                "email": r[3] or "",
                "type": r[4] or "",
                "rating": r[5] or "",
                "message": r[6] or "",
                "timestamp": r[7] or "",
                "source": "db",
            })
    except Exception as e:
        print(f"[admin] feedback db read failed: {e}")

    # 2) 历史日志文件（兼容旧数据）
    if os.path.exists(FEEDBACK_LOG):
        try:
            with open(FEEDBACK_LOG, "r") as f:
                content = f.read()
            blocks = content.split("\n=== ")
            for block in blocks:
                block = block.strip()
                if not block:
                    continue
                lines = block.split("\n")
                ts = lines[0].strip("= ")
                text = "\n".join(lines[1:]).strip()
                if text:
                    entries.append({"timestamp": ts, "content": text, "source": "log"})
        except Exception:
            pass

    return {"total": len(entries), "entries": entries}


@app.get("/api/admin/survey")
def admin_survey(_=Depends(require_admin)):
    if not os.path.exists(SURVEY_LOG):
        return {"total": 0, "entries": [], "stats": {}}

    entries = []
    with open(SURVEY_LOG, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                entries.append({"raw": line})

    stats = {}
    for e in entries:
        for qi in ["q1","q2","q3","q4","q5","q6","q6_reason"]:
            val = e.get(qi, "")
            if val or val == 0:
                key = f"q{qi[1:]}"
                if key not in stats:
                    stats[key] = {}
                sv = str(val)
                stats[key][sv] = stats[key].get(sv, 0) + 1

    return {
        "total": len(entries),
        "entries": entries,
        "stats": stats,
    }


# ── 前端 SPA ──

# 50KB 的 index.html 原来每个请求都从磁盘读一遍；按 mtime 缓存后只在文件变化时重读。
_SPA_CACHE = {"mtime": 0.0, "html": ""}


def _read_spa_html() -> str:
    try:
        mtime = os.path.getmtime(ADMIN_FRONTEND)
    except OSError:
        return ""
    if mtime != _SPA_CACHE["mtime"]:
        with open(ADMIN_FRONTEND, "r", encoding="utf-8") as f:
            _SPA_CACHE["html"] = f.read()
        _SPA_CACHE["mtime"] = mtime
    return _SPA_CACHE["html"]


@app.get("/{full_path:path}")
def serve_admin_frontend(full_path: str = ""):
    # 未匹配到的 /api/* 应当返回 JSON 404，而不是回一份 HTML——
    # 否则前端拿到 200 + HTML，会当成正常响应去解析，报错信息完全指错方向。
    if full_path.startswith("api/"):
        return JSONResponse(status_code=404, content={"detail": "接口不存在"})
    html = _read_spa_html()
    if html:
        return HTMLResponse(html, headers={"Cache-Control": "no-cache"})
    return HTMLResponse("<h1>Admin Panel</h1><p>Frontend not installed</p>")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
