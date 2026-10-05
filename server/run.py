#!/usr/bin/env python3
"""梗指北后端启动入口。

用法：
    python run.py                 # 使用默认配置启动
    python run.py --port 9000     # 指定端口
    python run.py --host 0.0.0.0  # 允许局域网 / 外网访问

仅依赖 Python 标准库，无需 pip install。
"""

import argparse
import sys
from pathlib import Path

# 保证从任意目录执行都能正确导入 app 包
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app import config, db, seed                       # noqa: E402
from app.server import build_server                    # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="梗指北后端服务")
    parser.add_argument("--host", default=None, help=f"监听地址（默认 {config.HOST}）")
    parser.add_argument("--port", type=int, default=None, help=f"监听端口（默认 {config.PORT}）")
    args = parser.parse_args()

    if args.host:
        config.HOST = args.host
    if args.port:
        config.PORT = args.port

    # 1) 建表（幂等）  2) 写入种子数据（幂等）
    db.init_db()
    seed.run()

    httpd = build_server()
    print("=" * 58)
    print("  梗指北 · 后端服务已启动")
    print("=" * 58)
    print(config.describe())
    print("-" * 58)
    print(f"  健康检查 : http://{config.HOST}:{config.PORT}/api/health")
    print("  按 Ctrl+C 停止服务")
    print("=" * 58)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n正在关闭服务…")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
