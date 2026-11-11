"""
NeuroAccess Auth Module
- SQLite user database
- bcrypt password hashing
- JWT token authentication
"""
import os
import secrets as _secrets
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any

from passlib.context import CryptContext
from jose import JWTError, jwt

BASE_DIR = os.path.dirname(__file__)
DB_PATH = os.path.join(BASE_DIR, "neuroaccess.db")

# JWT settings
_SECRET_KEY = os.getenv("JWT_SECRET_KEY")
if not _SECRET_KEY:
    # Generate a secure random key if not set (dev mode)
    _SECRET_KEY = _secrets.token_urlsafe(32)
    print("⚠️  WARNING: JWT_SECRET_KEY not set. Using auto-generated key.", file=sys.stderr)
    print("   All tokens will be invalidated on next restart.", file=sys.stderr)
    if os.getenv("DEBUG") != "1":
        print("   Set JWT_SECRET_KEY environment variable in production.", file=sys.stderr)
SECRET_KEY = _SECRET_KEY
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 60

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def get_db() -> sqlite3.Connection:
    """Get SQLite connection"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Initialize users and verification_codes tables"""
    conn = get_db()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS verification_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            email TEXT,
            code TEXT NOT NULL,
            purpose TEXT NOT NULL DEFAULT 'password_change',
            expires_at TIMESTAMP NOT NULL,
            used INTEGER NOT NULL DEFAULT 0,
            attempts INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
        """
    )
    # Add avatar_url column if not exists
    try:
        conn.execute("ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT ''")
    except Exception:
        pass  # column already exists
    # Add avatar_color column if not exists
    try:
        conn.execute("ALTER TABLE users ADD COLUMN avatar_color TEXT DEFAULT 'blue'")
    except Exception:
        pass  # column already exists
    # Add terms_accepted column if not exists
    try:
        conn.execute("ALTER TABLE users ADD COLUMN terms_accepted INTEGER DEFAULT 0")
    except Exception:
        pass  # column already exists
    # Add phone column if not exists (for phone login)
    try:
        conn.execute("ALTER TABLE users ADD COLUMN phone TEXT UNIQUE DEFAULT ''")
    except Exception:
        pass  # column already exists
    # Add phone_verified column if not exists
    try:
        conn.execute("ALTER TABLE users ADD COLUMN phone_verified INTEGER DEFAULT 0")
    except Exception:
        pass  # column already exists
    # Add survey_completed column if not exists (每个账户只能填一次问卷)
    try:
        conn.execute("ALTER TABLE users ADD COLUMN survey_completed INTEGER DEFAULT 0")
    except Exception:
        pass  # column already exists
    # Add phone column to verification_codes if not exists
    try:
        conn.execute("ALTER TABLE verification_codes ADD COLUMN phone TEXT")
    except Exception:
        pass  # column already exists
    # Add reports table for cross-device report sync
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS reports (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            file_name TEXT NOT NULL,
            date TEXT NOT NULL,
            mode TEXT NOT NULL DEFAULT 'Beginner',
            quality REAL NOT NULL DEFAULT 0,
            language TEXT DEFAULT 'zh',
            data TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    # 删除墓碑：报告一旦删除即永久记录，服务器拒绝再次保存/恢复，跨设备生效
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS deleted_reports (
            report_id TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (report_id, user_id)
        )
        """
    )
    # Add feedback table for permanent feedback storage (replaces fragile file log)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            name TEXT DEFAULT '',
            email TEXT DEFAULT '',
            type TEXT DEFAULT '',
            rating TEXT DEFAULT '',
            message TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )
        """
    )
    # Add survey table for permanent survey storage (replaces fragile file log)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS survey_submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            data TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )
        """
    )
    # Add email column if not exists (for registration codes)
    try:
        conn.execute("ALTER TABLE verification_codes ADD COLUMN email TEXT")
    except Exception:
        pass  # column already exists
    # Add attempts column if not exists
    try:
        conn.execute("ALTER TABLE verification_codes ADD COLUMN attempts INTEGER DEFAULT 0")
    except Exception:
        pass  # column already exists
    # Create index for faster lookup
    try:
        conn.execute("CREATE INDEX IF NOT EXISTS idx_verification_codes_email ON verification_codes(email, purpose, used)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_verification_codes_user ON verification_codes(user_id, purpose, used)")
    except Exception:
        pass
    # Add login_attempts and locked_until columns for brute force protection
    try:
        conn.execute("ALTER TABLE users ADD COLUMN login_attempts INTEGER DEFAULT 0")
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE users ADD COLUMN locked_until TIMESTAMP")
    except Exception:
        pass
    # ── 学校/机构免费计划 ──
    # organizations 表：学校自助入驻后生成机构邀请码
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS organizations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            contact_name TEXT DEFAULT '',
            contact_email TEXT DEFAULT '',
            invite_code TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    # users 增加 org_id（学生注册时填邀请码自动入校）
    try:
        conn.execute("ALTER TABLE users ADD COLUMN org_id INTEGER")
    except Exception:
        pass
    # users 增加 is_test（admin 面板区分测试账号）
    try:
        conn.execute("ALTER TABLE users ADD COLUMN is_test INTEGER DEFAULT 0")
    except Exception:
        pass
    conn.commit()
    conn.close()


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(data: Dict[str, Any]) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> Optional[Dict[str, Any]]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return dict(payload)
    except JWTError:
        return None


def _has_special_symbol(s: str) -> bool:
    """Check if string contains special characters
    Allowed: letters/numbers/spaces/CJK/emoji/underscore/hyphen
    Banned: .@#$%^&*()+=[]{}|\\;:'"`<>/?`~!,。
    """
    import re as _re
    return bool(_re.search(r"[!@#$%^&*()+\=\[\]{}|\\;:\'\"`/<>?~.,。]", s))


def _visual_length(s: str) -> int:
    """计算字符串的视觉长度（CJK/emoji 算 1，组合字符不算）。
    用 unicodedata.east_asian_width 判断，W/F（全角）= 2, 其他 = 1
    但我们这里想要"几个字"的简单感觉，所以简化：code point 数
    """
    import unicodedata
    count = 0
    i = 0
    while i < len(s):
        ch = s[i]
        cat = unicodedata.category(ch)
        # Skip combining marks (Mn, Mc, Me) for purposes of length counting
        if cat in ("Mn", "Mc", "Me"):
            i += 1
            continue
        # 简化：每个字符（包括 emoji）算 1 个字符长度
        count += 1
        i += 1
    return count


def _is_unicode_letter_start(s: str) -> bool:
    """Check if first char is a Unicode letter (CJK/Latin/Greek/Cyrillic/Arabic/Thai/Devanagari etc.)
    Python re module does not support \\p{L}, so use unicodedata.category
    """
    if not s:
        return False
    ch = s[0]
    import unicodedata
    cat = unicodedata.category(ch)
    # Lu = 大写字母, Ll = 小写字母, Lt = 标题字母, Lm = 修饰字母, Lo = 其他字母（含 CJK/希腊/西里尔/泰/天城文/阿拉伯等）
    return cat.startswith("L")


def create_user(username: str, email: str, password: str) -> Dict[str, Any]:
    """Create a new user. Returns user dict or raises ValueError."""
    if not username or not username.strip():
        raise ValueError("Username is required")
    username = username.strip()
    vlen = _visual_length(username)
    if vlen < 1 or vlen > 20:
        raise ValueError("Username must be 1-20 characters")
    # Must start with a letter (Unicode letters: CJK, Latin, Greek, Cyrillic, etc.)
    if not _is_unicode_letter_start(username):
        raise ValueError("Username must start with a letter (not a number, space, or symbol)")
    # No special symbols (numbers/letters/spaces/CJK/emoji/underscores/hyphens/dots/commas allowed)
    if _has_special_symbol(username):
        raise ValueError("Username cannot contain special symbols (@#$%^&*()+=[]{}|\\;:'\"`<>/?`~!)")
    import re as _re
    if _re.search(r"\s{2,}", username):
        raise ValueError("Username cannot contain consecutive spaces")
    if len(password) < 6:
        raise ValueError("Password must be at least 6 characters")
    if "@" not in email or "." not in email:
        raise ValueError("Invalid email address")

    conn = get_db()
    try:
        cursor = conn.execute(
            "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
            (username, email, hash_password(password)),
        )
        conn.commit()
        user_id = cursor.lastrowid
        return {
            "id": user_id,
            "username": username,
            "email": email,
            "avatar_url": "",
            "avatar_color": "blue",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    except sqlite3.IntegrityError as e:
        if "username" in str(e).lower():
            raise ValueError("Username already exists")
        raise ValueError("Email already exists")
    finally:
        conn.close()


def authenticate_user(username_or_email: str, password: str) -> Optional[Dict[str, Any]]:
    """Authenticate user by username or email. Returns user dict or None.
    
    Implements brute force protection: locks account for 15 minutes after 5
    consecutive failed login attempts.
    """
    conn = get_db()
    MAX_ATTEMPTS = 5
    LOCK_MINUTES = 15
    now = datetime.now(timezone.utc)

    try:
        # Try username first
        row = conn.execute(
            "SELECT id, username, email, avatar_url, avatar_color, password_hash, "
            "created_at, terms_accepted, login_attempts, locked_until, survey_completed "
            "FROM users WHERE username = ?",
            (username_or_email,),
        ).fetchone()

        # If not found, try email
        if row is None:
            row = conn.execute(
                "SELECT id, username, email, avatar_url, avatar_color, password_hash, "
                "created_at, terms_accepted, login_attempts, locked_until, survey_completed "
                "FROM users WHERE email = ?",
                (username_or_email,),
            ).fetchone()

        if row is None:
            # User not found — add a small constant delay to prevent timing-based
            # user enumeration (mimics the time a failed password check takes)
            import time
            time.sleep(0.3)
            return None

        # Check if account is locked
        locked_until = row["locked_until"]
        if locked_until:
            locked_dt = datetime.fromisoformat(locked_until)
            if locked_dt > now:
                remaining = int((locked_dt - now).total_seconds())
                conn.close()
                raise PermissionError(
                    f"Account temporarily locked due to too many failed attempts. "
                    f"Please try again in {remaining} seconds."
                )
            # Lock period expired, clear lock and reset attempts
            conn.execute(
                "UPDATE users SET locked_until = NULL, login_attempts = 0 WHERE id = ?",
                (row["id"],),
            )
            conn.commit()
            row["login_attempts"] = 0

        # Verify password
        if not verify_password(password, row["password_hash"]):
            # Increment failed attempts
            attempts = (row["login_attempts"] or 0) + 1
            if attempts >= MAX_ATTEMPTS:
                lock_time = now + timedelta(minutes=LOCK_MINUTES)
                conn.execute(
                    "UPDATE users SET login_attempts = ?, locked_until = ? WHERE id = ?",
                    (attempts, lock_time, row["id"]),
                )
                conn.commit()
                conn.close()
                raise PermissionError(
                    f"Account locked for {LOCK_MINUTES} minutes due to {MAX_ATTEMPTS} "
                    f"consecutive failed login attempts."
                )
            else:
                conn.execute(
                    "UPDATE users SET login_attempts = ? WHERE id = ?",
                    (attempts, row["id"]),
                )
                conn.commit()
            return None

        # Successful login — reset attempts
        if row["login_attempts"]:
            conn.execute(
                "UPDATE users SET login_attempts = 0, locked_until = NULL WHERE id = ?",
                (row["id"],),
            )
            conn.commit()

        return {
            "id": row["id"],
            "username": row["username"],
            "email": row["email"],
            "avatar_url": row["avatar_url"] or "",
            "avatar_color": row["avatar_color"] or "blue",
            "created_at": row["created_at"],
            "terms_accepted": row["terms_accepted"],
        }
    finally:
        conn.close()


def get_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    """Get user by ID"""
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT id, username, email, avatar_url, avatar_color, created_at, terms_accepted, survey_completed FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if row:
            return dict(row)
        return None
    finally:
        conn.close()


def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    """Get user by email"""
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT id, username, email, avatar_url, avatar_color, created_at, terms_accepted, survey_completed FROM users WHERE email = ?",
            (email,),
        ).fetchone()
        if row:
            return dict(row)
        return None
    finally:
        conn.close()


def generate_verification_code(user_id: Optional[int] = None, email: Optional[str] = None, purpose: str = "password_change") -> str:
    """Generate a 6-digit verification code. Returns the plaintext code (caller sends it).
    The code is stored as a bcrypt hash in the database.
    For registration codes, pass email instead of user_id.
    """
    code = f"{_secrets.randbelow(900000) + 100000}"
    code_hash = pwd_context.hash(code)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)
    conn = get_db()
    try:
        # Invalidate any existing unused codes for this user/email + purpose
        if user_id:
            conn.execute(
                "UPDATE verification_codes SET used = 1 WHERE user_id = ? AND purpose = ? AND used = 0",
                (user_id, purpose),
            )
        elif email:
            conn.execute(
                "UPDATE verification_codes SET used = 1 WHERE email = ? AND purpose = ? AND used = 0",
                (email, purpose),
            )
        conn.execute(
            "INSERT INTO verification_codes (user_id, email, code, purpose, expires_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, email, code_hash, purpose, expires_at.isoformat()),
        )
        conn.commit()
        return code
    finally:
        conn.close()


def verify_verification_code(user_id: Optional[int] = None, email: Optional[str] = None, code: str = "", purpose: str = "password_change") -> bool:
    """Verify a 6-digit code. Marks it as used if valid. Max 3 attempts.
    For registration codes, pass email instead of user_id.
    """
    conn = get_db()
    try:
        # 兼容 expires_at 同时为 'YYYY-MM-DDTHH:MM:SS' (naive ISO) 和 'YYYY-MM-DD HH:MM:SS' (SQLite CURRENT_TIMESTAMP) 两种格式
        def _parse_expires(s: str) -> datetime:
            try:
                return datetime.fromisoformat(s)
            except ValueError:
                return datetime.strptime(s, "%Y-%m-%d %H:%M:%S")

        def _all_active_codes() -> list:
            """返回该 user/email + purpose 下所有未过期的有效验证码（按 created_at 倒序）"""
            if user_id:
                rows = conn.execute(
                    "SELECT id, code, expires_at, attempts FROM verification_codes WHERE user_id = ? AND purpose = ? AND used = 0 ORDER BY created_at DESC",
                    (user_id, purpose),
                ).fetchall()
            elif email:
                rows = conn.execute(
                    "SELECT id, code, expires_at, attempts FROM verification_codes WHERE email = ? AND purpose = ? AND used = 0 ORDER BY created_at DESC",
                    (email, purpose),
                ).fetchall()
            else:
                return []
            return [r for r in rows if _parse_expires(r["expires_at"]) > datetime.now(timezone.utc)]

        # 1) 检查整个 purpose 下未过期且未使用次数超限的验证码，是否因为 attempts 已经被超限标记
        active = _all_active_codes()
        if not active:
            return False  # 全部过期或无验证码

        # 2) 找到匹配的 code (stored as bcrypt hash, so use pwd_context.verify)
        matched = next((r for r in active if pwd_context.verify(code, r["code"])), None)
        if not matched:
            # Code not found - increment attempts for all active codes
            if user_id:
                conn.execute(
                    "UPDATE verification_codes SET attempts = attempts + 1 WHERE user_id = ? AND purpose = ? AND used = 0",
                    (user_id, purpose),
                )
            elif email:
                conn.execute(
                    "UPDATE verification_codes SET attempts = attempts + 1 WHERE email = ? AND purpose = ? AND used = 0",
                    (email, purpose),
                )
            conn.commit()
            return False

        # 3) 如果匹配的 code 已经超限
        if matched["attempts"] >= 3:
            conn.execute("UPDATE verification_codes SET used = 1 WHERE id = ?", (matched["id"],))
            conn.commit()
            return False

        # 4) 标记使用
        conn.execute("UPDATE verification_codes SET used = 1 WHERE id = ?", (matched["id"],))
        conn.commit()
        return True
    finally:
        conn.close()


def update_password(user_id: int, new_password: str) -> bool:
    """Update user password. Returns True on success."""
    if len(new_password) < 6:
        raise ValueError("Password must be at least 6 characters")
    conn = get_db()
    try:
        cursor = conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (hash_password(new_password), user_id),
        )
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def update_email(user_id: int, new_email: str) -> bool:
    """Update user email. Returns True on success."""
    conn = get_db()
    try:
        # Check if new_email is already taken
        existing = conn.execute("SELECT id FROM users WHERE email = ? AND id != ?", (new_email, user_id)).fetchone()
        if existing:
            return False
        cursor = conn.execute(
            "UPDATE users SET email = ? WHERE id = ?",
            (new_email, user_id),
        )
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def delete_user(user_id: int) -> bool:
    """Delete user and all related data. Returns True on success."""
    conn = get_db()
    try:
        # Delete related data first (reports, verification_codes, etc.)
        conn.execute("DELETE FROM reports WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM verification_codes WHERE user_id = ?", (user_id,))
        # Delete user
        cursor = conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def accept_terms(user_id: int) -> bool:
    """Mark user as having accepted terms. Returns True on success."""
    conn = get_db()
    try:
        cursor = conn.execute(
            "UPDATE users SET terms_accepted = 1 WHERE id = ?",
            (user_id,),
        )
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def check_username_setup(user_id: int) -> bool:
    """Check if user needs to set up username (default 'User' or empty). Returns True if setup needed."""
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT username FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not row:
            return False
        username = row["username"]
        return username == "User" or username.strip() == ""
    finally:
        conn.close()


# ── Phone Number Authentication ──────────────────────────────────────

def _is_valid_phone(phone: str) -> bool:
    """Validate phone number format (simple: digits, 8-15 chars)."""
    import re
    phone = phone.strip()
    return bool(re.match(r"^\+?[0-9]{8,15}$", phone))


def get_user_by_phone(phone: str) -> Optional[Dict[str, Any]]:
    """Get user by phone number. Returns user dict or None."""
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT id, username, email, phone, avatar_url, avatar_color, created_at, terms_accepted FROM users WHERE phone = ?",
            (phone.strip(),),
        ).fetchone()
        if row:
            return dict(row)
        return None
    finally:
        conn.close()


def create_user_with_phone(username: str, phone: str, password: str) -> Dict[str, Any]:
    """Create a new user with phone as primary credential. Returns user dict or raises ValueError."""
    if not _is_valid_phone(phone):
        raise ValueError("Invalid phone number format")
    if len(password) < 6:
        raise ValueError("Password must be at least 6 characters")

    conn = get_db()
    try:
        # Use phone as default email placeholder
        email = f"phone_{phone.replace('+','')}@neuroaccess.local"
        cursor = conn.execute(
            "INSERT INTO users (username, email, phone, password_hash, phone_verified) VALUES (?, ?, ?, ?, 1)",
            (username, email, phone.strip(), hash_password(password)),
        )
        conn.commit()
        user_id = cursor.lastrowid
        return {
            "id": user_id,
            "username": username,
            "email": "",
            "phone": phone.strip(),
            "avatar_url": "",
            "avatar_color": "blue",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    except sqlite3.IntegrityError:
        raise ValueError("Phone number already exists")
    finally:
        conn.close()


def authenticate_by_phone(phone: str, password: str) -> Optional[Dict[str, Any]]:
    """Authenticate user by phone + password. Returns user dict or None."""
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT id, username, email, phone, avatar_url, avatar_color, password_hash, created_at, terms_accepted FROM users WHERE phone = ?",
            (phone.strip(),),
        ).fetchone()
        if row is None:
            return None
        if not verify_password(password, row["password_hash"]):
            return None
        return {
            "id": row["id"],
            "username": row["username"],
            "email": row["email"],
            "phone": row["phone"],
            "avatar_url": row["avatar_url"] or "",
            "avatar_color": row["avatar_color"] or "blue",
            "created_at": row["created_at"],
            "terms_accepted": row["terms_accepted"],
        }
    finally:
        conn.close()


def update_phone(user_id: int, new_phone: str) -> bool:
    """Update user phone number. Returns True on success."""
    conn = get_db()
    try:
        existing = conn.execute("SELECT id FROM users WHERE phone = ? AND id != ?", (new_phone.strip(), user_id)).fetchone()
        if existing:
            return False
        cursor = conn.execute(
            "UPDATE users SET phone = ?, phone_verified = 1 WHERE id = ?",
            (new_phone.strip(), user_id),
        )
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


# Initialize DB on module load
init_db()
