"""初始化种子数据：内置管理员 yg，以及 45 篇图片随笔。

对应原前端 `js/main.js` 里的 `Auth.init()` + `syncYgPosts()`：
后端模式下改成「首次启动时若表为空则写入一次」，不再每次访问都同步。
"""

from . import config
from .db import db
from .security import hash_password
from .util import iso_from_millis, now_iso

# images 目录中的图片时间戳清单（wx_camera_<毫秒时间戳>.jpg），一张图 = 一篇 yg 博客
YG_IMAGE_TIMESTAMPS = [
    1755160979291, 1755161002435, 1755161021266, 1755161040894, 1755161058913,
    1755161074489, 1755161086511, 1755161106930, 1755161120059, 1755161151516,
    1755161162779, 1755161177626, 1755161195407, 1755161208649, 1755161224863,
    1755161235921, 1755161258263, 1755161268498, 1755161283206, 1755161293262,
    1755161320306, 1755161342472, 1755161356103, 1755161380735, 1755161397804,
    1755161413094, 1755161426485, 1755161436973, 1755161452294, 1755161463787,
    1755161477103, 1755161490339, 1755161505306, 1755161516836, 1755161530497,
    1755161543790, 1755161561345, 1755161575081, 1755161587208, 1755161602771,
    1755161620699, 1755161630923, 1755161646865, 1755161660587, 1755161779231,
]

TITLE_POOL = [
    "清晨的光", "路边的小景", "随手一拍", "街角偶遇", "午后的静谧",
    "走走停停", "寻常日子", "窗外的风景", "慢下来的时光", "定格的瞬间",
    "安静的角落", "路上的风景", "生活碎片", "光影之间", "日常记录",
]

TEXT_POOL = [
    "今天出门散步时随手拍下的画面，光线刚好，就把它留了下来。",
    "没有刻意构图，只是觉得那一刻很舒服，于是按下了快门。",
    "生活里值得记住的往往都是这种很小的瞬间。",
    "天气不错，风也温柔，走走看看，心情就跟着松了下来。",
    "照片拍得一般，但当时的感受是真实的，所以想存一份。",
    "喜欢这种安静的时刻，不需要说话，看着就很治愈。",
    "同一处地方，换一个角度就有了不一样的样子。",
    "把平常的一天记录下来，回头看会很有意思。",
    "本来只是路过，结果停下来看了很久。",
    "这些细碎的日常，拼起来就是生活本身。",
    "阳光落在上面的时候，颜色比想象中更好看。",
    "没有什么特别的理由，单纯觉得好看就拍了。",
]


def build_yg_posts() -> list:
    """生成 45 篇 yg 的图片博客（标题 / 正文按索引循环取词，与前端一致）。"""
    posts = []
    for index, ts in enumerate(YG_IMAGE_TIMESTAMPS):
        filename = f"wx_camera_{ts}.jpg"
        title = f"{TITLE_POOL[index % len(TITLE_POOL)]} · {index + 1:02d}"
        content = (
            TEXT_POOL[index % len(TEXT_POOL)]
            + "\n"
            + TEXT_POOL[(index * 5 + 3) % len(TEXT_POOL)]
        )
        posts.append(
            {
                "id": f"yg-wx_camera_{ts}",
                "title": title,
                "content": content,
                "image": f"images/{filename}",
                "author": config.ADMIN_USERNAME,
                "author_role": "admin",
                "source": "seed",
                "created_at": iso_from_millis(ts),
            }
        )
    return posts


def seed_admin() -> None:
    """确保管理员 yg 存在。"""
    with db() as conn:
        row = conn.execute(
            "SELECT id FROM users WHERE username = ? COLLATE NOCASE",
            (config.ADMIN_USERNAME,),
        ).fetchone()
        if row:
            return
        conn.execute(
            "INSERT INTO users(id, username, password_hash, real_name, role, avatar, created_at) "
            "VALUES(?,?,?,?,?,?,?)",
            (
                f"u-{config.ADMIN_USERNAME}",
                config.ADMIN_USERNAME,
                hash_password(config.ADMIN_DEFAULT_PASSWORD),
                config.ADMIN_REAL_NAME,
                "admin",
                "",
                now_iso(),
            ),
        )


def seed_yg_posts() -> None:
    """仅当博客表为空时，写入 45 篇图片随笔。"""
    with db() as conn:
        count = conn.execute("SELECT COUNT(*) AS c FROM posts").fetchone()["c"]
        if count > 0:
            return
        conn.executemany(
            "INSERT INTO posts(id, title, content, image, author, author_role, source, created_at) "
            "VALUES(:id, :title, :content, :image, :author, :author_role, :source, :created_at)",
            build_yg_posts(),
        )


def run() -> None:
    """执行全部种子逻辑（幂等）。"""
    seed_admin()
    seed_yg_posts()
