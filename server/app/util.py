"""通用小工具：时间、id、用户名校验。"""

import re
import secrets
from datetime import datetime, timezone

# 用户名允许：字母、数字、下划线、中文
USERNAME_RE = re.compile(r"^[\w\u4e00-\u9fa5]+$", re.UNICODE)


def now_iso() -> str:
    """当前 UTC 时间，ISO 8601 字符串（形如 2025-08-14T08:42:59.123Z）。"""
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def iso_from_millis(ms: int) -> str:
    """把毫秒时间戳转成 ISO 字符串（用于生成 yg 的图片博客发布时间）。"""
    return (
        datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def uid(prefix: str = "id") -> str:
    """生成唯一 id，如 u-3f2a1b9c8d7e6f50。"""
    return f"{prefix}-{secrets.token_hex(8)}"


def norm_username(value) -> str:
    """用户名去除首尾空白。"""
    return str(value or "").strip()
