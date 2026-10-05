"""密码哈希与登录令牌。

密码使用 PBKDF2-HMAC-SHA256 加随机盐哈希后存储，**不保存明文**；
登录令牌为随机不可猜的字符串，保存在 sessions 表中。
"""

import hashlib
import hmac
import secrets

_ALGO = "pbkdf2_sha256"
_ITERATIONS = 200_000
_SALT_BYTES = 16


def hash_password(password: str) -> str:
    """返回 `pbkdf2_sha256$迭代次数$盐$哈希` 形式的字符串。"""
    salt = secrets.token_bytes(_SALT_BYTES)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _ITERATIONS)
    return f"{_ALGO}${_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """校验明文密码与存储的哈希是否匹配（使用恒定时间比较）。"""
    try:
        algo, iterations, salt_hex, hash_hex = str(stored).split("$")
        if algo != _ALGO:
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations)
        )
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


def new_token() -> str:
    """生成一个新的登录令牌。"""
    return secrets.token_urlsafe(32)
