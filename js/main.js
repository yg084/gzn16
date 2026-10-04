/* ==========================================================================
 * main.js —— 梗指北 · 全部业务逻辑
 * --------------------------------------------------------------------------
 * 本文件包含：
 *   1. 配置与常量
 *   2. 通用工具函数（转义、时间格式化、Toast、图片压缩…）
 *   3. 本地存储读写层（localStorage 封装）
 *   4. 用户模块（注册 / 登录 / 退出 / 权限判断 / 头像上传）
 *   5. 图片清单 + 自动生成管理员 yg 的博客条目
 *   6. 博客模块（发布 / 查询 / 删除）
 *   7. 评论模块（发表 / 查询 / 删除）
 *   8. 视图层（公共导航、首页渲染、各页面初始化）
 *   9. 管理后台（可视化管理员 mg：用户 / 博客 / 评论 / 数据管理）
 *
 * 无任何第三方依赖，直接用浏览器打开 HTML 即可运行。
 * 数据全部保存在 localStorage 中，刷新页面不会丢失。
 * ========================================================================== */
(function () {
  'use strict';

  /* ======================================================================
   * 一、配置与常量
   * ====================================================================== */

  /** localStorage 中使用到的 key，集中管理避免散落各处写错 */
  var STORAGE_KEY = {
    users: 'blog_users',              // 用户列表
    posts: 'blog_posts',              // 博客列表
    comments: 'blog_comments',        // 评论列表
    session: 'blog_session',          // 当前登录状态
    removedPosts: 'blog_removed_posts',// 被删除的「yg 预置博客」id，避免刷新后自动复活
    feedback: 'blog_feedback',        // 用户提交的意见反馈
    adminText: 'blog_admin_text'      // 管理员博客文字的本地覆盖（待提交到仓库）
  };

  /** 管理员账号信息（系统内置，不可注册占用） */
  var ADMIN_USERNAME = 'yg';
  var ADMIN_DEFAULT_PASSWORD = 'yg123456';
  var ADMIN_REAL_NAME = '管理员';

  /** 站点名称（用于浏览器标题栏等文案） */
  var SITE_NAME = '梗指北';

  /** 业务限制常量 */
  var LIMITS = {
    usernameMin: 2,
    usernameMax: 16,
    passwordMin: 6,
    titleMax: 60,
    contentMax: 5000,
    commentMax: 500,
    imageMaxMB: 5,        // 用户上传图片的原始大小上限
    imageMaxSide: 1280,   // 压缩后最长边像素
    imageQuality: 0.82,   // 压缩后的 JPEG 质量
    avatarMaxMB: 2,       // 用户上传头像的原始大小上限
    avatarSize: 256,      // 头像压缩后的正方形边长（像素）
    avatarQuality: 0.85,  // 头像压缩后的 JPEG 质量
    realNameMin: 2,       // 真实姓名最短长度
    realNameMax: 20,      // 真实姓名最长长度
    feedbackMax: 500,     // 单条反馈内容的字数上限
    feedbackContactMax: 80 // 反馈联系方式字数上限
  };

  /* ======================================================================
   * 二、通用工具函数
   * ====================================================================== */

  /** 生成一个足够简单的唯一 id（时间戳 + 随机串） */
  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 8);
  }

  /**
   * 转义 HTML 特殊字符，防止用户输入的内容破坏页面结构（简易 XSS 防护）
   * @param {*} str 任意待转义内容
   * @returns {string}
   */
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 用指定的规则把 HTML 字符串安全插入到容器中（只用于我们自己拼好的模板） */
  function htmlToElement(html) {
    var tpl = document.createElement('template');
    tpl.innerHTML = html.trim();
    return tpl.content.firstElementChild;
  }

  /**
   * 把时间格式化为「YYYY-MM-DD HH:mm」形式
   * @param {string|number|Date} value 时间
   */
  function formatTime(value) {
    var d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /**
   * 用户名/密码的简易摘要（djb2 变体）
   * 注意：这只是为了不让密码以完全明文出现，纯前端场景不存在真正的安全边界，
   *      仅用于教学演示，切勿用于真实生产环境。
   */
  function simpleHash(text) {
    var str = 'blog$' + String(text);
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16);
  }

  /** 底部轻提示 */
  var toastTimer = null;
  function toast(message) {
    var el = document.getElementById('toast');
    if (!el) { alert(message); return; }
    el.textContent = message;
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('is-show');
    }, 2200);
  }

  /** 在表单顶部显示提示信息（错误 / 成功） */
  function showFormMsg(el, message, type) {
    if (!el) return;
    el.textContent = message || '';
    el.className = 'form-msg' + (type ? ' form-msg--' + type : '');
  }

  /**
   * 把用户选择的图片文件压缩为 dataURL，避免 localStorage 空间被迅速占满
   * - GIF 体积较小时直接保留原图（避免动画丢失）
   * @param {File} file 图片文件
   * @returns {Promise<string>} dataURL
   */
  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('没有选择图片'));

      var rawSizeMB = file.size / 1024 / 1024;
      if (rawSizeMB > LIMITS.imageMaxMB) {
        return reject(new Error('图片过大，请选择 ' + LIMITS.imageMaxMB + 'MB 以内的图片'));
      }

      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('图片读取失败，请重试')); };
      reader.onload = function () {
        var dataUrl = reader.result;

        // GIF 且体积不大：保留原图（canvas 重绘会丢失动画帧）
        if (file.type === 'image/gif' && file.size < 500 * 1024) {
          return resolve(dataUrl);
        }

        var img = new Image();
        img.onerror = function () { resolve(dataUrl); }; // 解码失败时退回原图
        img.onload = function () {
          var maxSide = LIMITS.imageMaxSide;
          var scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          var w = Math.max(1, Math.round(img.width * scale));
          var h = Math.max(1, Math.round(img.height * scale));

          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext('2d');
          // 白底，避免 PNG 透明区域转 JPEG 后变黑
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);

          try {
            var out = canvas.toDataURL('image/jpeg', LIMITS.imageQuality);
            // 压缩反而更大时，用原图
            resolve(out && out.length < dataUrl.length ? out : dataUrl);
          } catch (e) {
            resolve(dataUrl);
          }
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ----------------------------- 头像相关工具 ----------------------------- */

  /** 取用户名的首字符作为无头像时的占位（中文取第一个字，英文取大写字母） */
  function avatarInitial(username) {
    var name = String(username == null ? '' : username).trim();
    return name ? name.charAt(0).toUpperCase() : '?';
  }

  /** 按用户名（不区分大小写）查找用户对象 */
  function findUserByName(username) {
    var name = String(username == null ? '' : username).toLowerCase();
    if (!name) return null;
    var users = Store.getUsers();
    return users.find(function (u) {
      return String(u.username || '').toLowerCase() === name;
    }) || null;
  }

  /**
   * 生成头像的 HTML：有自定义头像时输出 img，否则输出用户名首字符占位块
   * @param {string} username 用户名（作者名）
   * @param {string} [size]   'sm' | 'md'（默认）| 'lg'
   * @returns {string} HTML
   */
  function avatarHtml(username, size) {
    var cls = 'avatar' + (size ? ' avatar--' + size : '');
    var user = findUserByName(username);
    if (user && user.avatar) {
      return '<img class="' + cls + '" src="' + escapeHtml(user.avatar) +
        '" alt="' + escapeHtml(username) + ' 的头像" loading="lazy" />';
    }
    return '<span class="' + cls + ' avatar--placeholder" aria-hidden="true">' +
      escapeHtml(avatarInitial(username)) + '</span>';
  }

  /**
   * 把用户选择的图片压缩为正方形头像（默认 256×256，JPEG）
   * 步骤：读取文件 → 居中裁剪为正方形 → 等比缩放到目标尺寸 → 输出 dataURL
   * @param {File} file 图片文件
   * @returns {Promise<string>} dataURL
   */
  function compressAvatar(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('没有选择图片'));

      if (file.size / 1024 / 1024 > LIMITS.avatarMaxMB) {
        return reject(new Error('头像图片过大，请选择 ' + LIMITS.avatarMaxMB + 'MB 以内的图片'));
      }
      if (file.type && file.type.indexOf('image/') !== 0) {
        return reject(new Error('请选择 jpg / png / gif / webp 等图片文件'));
      }

      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('图片读取失败，请重试')); };
      reader.onload = function () {
        var dataUrl = reader.result;

        var img = new Image();
        img.onerror = function () { resolve(dataUrl); }; // 解码失败时退回原图
        img.onload = function () {
          var side = Math.min(img.width, img.height) || 1;
          var sx = Math.max(0, Math.round((img.width - side) / 2)); // 水平居中裁剪
          var sy = Math.max(0, Math.round((img.height - side) / 2)); // 垂直居中裁剪
          var out = LIMITS.avatarSize;

          var canvas = document.createElement('canvas');
          canvas.width = out;
          canvas.height = out;
          var ctx = canvas.getContext('2d');
          // 白底，避免 PNG 透明区域转 JPEG 后变黑
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, out, out);
          ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);

          try {
            resolve(canvas.toDataURL('image/jpeg', LIMITS.avatarQuality) || dataUrl);
          } catch (e) {
            resolve(dataUrl);
          }
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ======================================================================
   * 三、本地存储读写层
   * ----------------------------------------------------------------------
   * 统一在一个模块里读写 localStorage，业务代码只操作数组/对象，不必关心 JSON 解析。
   * ====================================================================== */
  var Store = {
    /** 读取并 JSON 解析，失败时返回默认值 */
    read: function (key, fallback) {
      try {
        var raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        var parsed = JSON.parse(raw);
        return parsed === null ? fallback : parsed;
      } catch (e) {
        console.warn('[Store] 读取失败:', key, e);
        return fallback;
      }
    },

    /**
     * 序列化写入；写入失败（常见于超出配额）时抛出可读错误
     */
    write: function (key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        console.error('[Store] 写入失败:', key, e);
        throw new Error('本地存储空间不足，请删除一些含图片的博客后重试');
      }
    },

    /* ------------------------- 业务快捷方法 ------------------------- */
    getUsers: function () { return this.read(STORAGE_KEY.users, []); },
    saveUsers: function (list) { return this.write(STORAGE_KEY.users, list); },

    getPosts: function () { return this.read(STORAGE_KEY.posts, []); },
    savePosts: function (list) { return this.write(STORAGE_KEY.posts, list); },

    getComments: function () { return this.read(STORAGE_KEY.comments, []); },
    saveComments: function (list) { return this.write(STORAGE_KEY.comments, list); },

    getSession: function () { return this.read(STORAGE_KEY.session, null); },
    saveSession: function (session) { return this.write(STORAGE_KEY.session, session); },
    clearSession: function () {
      try { localStorage.removeItem(STORAGE_KEY.session); } catch (e) { /* 忽略 */ }
    },

    getRemovedPosts: function () { return this.read(STORAGE_KEY.removedPosts, []); },
    saveRemovedPosts: function (list) { return this.write(STORAGE_KEY.removedPosts, list); },

    getFeedback: function () { return this.read(STORAGE_KEY.feedback, []); },
    saveFeedback: function (list) { return this.write(STORAGE_KEY.feedback, list); },

    getAdminText: function () { return this.read(STORAGE_KEY.adminText, {}); },
    saveAdminText: function (map) { return this.write(STORAGE_KEY.adminText, map); }
  };

  /* ======================================================================
   * 四、用户模块
   * ====================================================================== */

  var Auth = {
    /** 初始化：确保管理员 yg 一定存在，并补齐真实姓名 / 明文密码等字段 */
    init: function () {
      var users = Store.getUsers();
      var admin = users.find(function (u) {
        return u.username.toLowerCase() === ADMIN_USERNAME;
      });

      if (!admin) {
        users.push({
          id: 'u-' + ADMIN_USERNAME,
          username: ADMIN_USERNAME,
          password: simpleHash(ADMIN_DEFAULT_PASSWORD),
          passwordPlain: ADMIN_DEFAULT_PASSWORD,   // 明文密码，仅供管理后台查看
          realName: ADMIN_REAL_NAME,               // 真实姓名（仅用户主页 / 后台可见）
          role: 'admin',
          avatar: '',                   // 头像（dataURL），为空时使用首字符占位
          createdAt: new Date().toISOString()
        });
        Store.saveUsers(users);
      } else {
        // 兼容旧数据：补齐后新增的字段
        var changed = false;
        if (typeof admin.realName !== 'string' || !admin.realName) {
          admin.realName = ADMIN_REAL_NAME;
          changed = true;
        }
        if (typeof admin.passwordPlain !== 'string' || !admin.passwordPlain) {
          admin.passwordPlain = ADMIN_DEFAULT_PASSWORD;
          changed = true;
        }
        if (changed) Store.saveUsers(users);
      }
    },

    /** 获取当前登录用户（从 session 中按用户名回查完整用户对象） */
    current: function () {
      var session = Store.getSession();
      if (!session || !session.username) return null;
      var users = Store.getUsers();
      var user = users.find(function (u) {
        return u.username.toLowerCase() === String(session.username).toLowerCase();
      });
      return user || null;
    },

    /** 是否已登录 */
    isLoggedIn: function () { return !!this.current(); },

    /** 当前用户是否为管理员 */
    isAdmin: function () {
      var user = this.current();
      return !!user && user.role === 'admin';
    },

    /**
     * 注册：校验 → 查重 → 写入用户表 → 自动登录
     * @param {string} username  用户名
     * @param {string} password  密码
     * @param {string} password2 确认密码
     * @param {string} realName  真实姓名（必填，一般不对外显示）
     * @returns {{ok:boolean, message:string}}
     */
    register: function (username, password, password2, realName) {
      username = String(username || '').trim();
      password = String(password || '');
      password2 = String(password2 || '');
      realName = String(realName || '').trim();

      if (!username || !password) return { ok: false, message: '用户名和密码不能为空' };
      if (!realName) return { ok: false, message: '请填写真实姓名' };
      if (realName.length < LIMITS.realNameMin || realName.length > LIMITS.realNameMax) {
        return { ok: false, message: '真实姓名长度需为 ' + LIMITS.realNameMin + '-' + LIMITS.realNameMax + ' 个字' };
      }
      if (username.length < LIMITS.usernameMin || username.length > LIMITS.usernameMax) {
        return { ok: false, message: '用户名长度需为 ' + LIMITS.usernameMin + '-' + LIMITS.usernameMax + ' 位' };
      }
      if (!/^[\w\u4e00-\u9fa5]+$/.test(username)) {
        return { ok: false, message: '用户名只能包含字母、数字、下划线或中文' };
      }
      if (username.toLowerCase() === ADMIN_USERNAME) {
        return { ok: false, message: '“' + ADMIN_USERNAME + '”是管理员保留用户名，不可注册' };
      }
      if (password.length < LIMITS.passwordMin) {
        return { ok: false, message: '密码至少 ' + LIMITS.passwordMin + ' 位' };
      }
      if (password !== password2) {
        return { ok: false, message: '两次输入的密码不一致' };
      }

      var users = Store.getUsers();
      var duplicated = users.some(function (u) {
        return u.username.toLowerCase() === username.toLowerCase();
      });
      if (duplicated) return { ok: false, message: '该用户名已被注册，请换一个' };

      var user = {
        id: uid('u'),
        username: username,
        password: simpleHash(password),
        passwordPlain: password,      // 明文密码，仅供管理后台查看
        realName: realName,           // 真实姓名（仅用户主页 / 后台可见）
        role: 'user',                 // 新注册用户一律为普通用户
        avatar: '',                   // 头像（dataURL），可在导航/专区点击头像上传
        createdAt: new Date().toISOString()
      };
      users.push(user);
      try {
        Store.saveUsers(users);
      } catch (e) {
        return { ok: false, message: e.message || '注册失败，请重试' };
      }

      // 注册成功后自动登录
      Store.saveSession({ username: user.username, loginAt: new Date().toISOString() });
      return { ok: true, message: '注册成功，已自动登录' };
    },

    /**
     * 登录：校验用户名/密码
     * @returns {{ok:boolean, message:string}}
     */
    login: function (username, password) {
      username = String(username || '').trim();
      password = String(password || '');
      if (!username || !password) return { ok: false, message: '请输入用户名和密码' };

      var users = Store.getUsers();
      var user = users.find(function (u) {
        return u.username.toLowerCase() === username.toLowerCase();
      });
      if (!user) return { ok: false, message: '用户不存在，请先注册' };
      if (user.password !== simpleHash(password)) return { ok: false, message: '密码错误，请重新输入' };

      Store.saveSession({ username: user.username, loginAt: new Date().toISOString() });
      return { ok: true, message: '登录成功，欢迎回来 ' + user.username };
    },

    /** 退出登录 */
    logout: function () {
      Store.clearSession();
    },

    /** 是否拥有发布博客的权限（登录即可） */
    canPublish: function () { return this.isLoggedIn(); },

    /**
     * 是否可以删除某篇博客：作者本人 或 管理员
     */
    canDeletePost: function (post) {
      var user = this.current();
      if (!user || !post) return false;
      return user.role === 'admin' || user.username === post.author;
    },

    /**
     * 读取某个用户名对应的头像（dataURL），没有设置则返回空串
     * @param {string} username
     * @returns {string}
     */
    avatarOf: function (username) {
      var user = findUserByName(username);
      return (user && user.avatar) || '';
    },

    /**
     * 更新当前登录用户的头像
     * @param {string} dataUrl 头像 dataURL；传空串表示移除头像
     * @returns {{ok:boolean, message:string}}
     */
    updateAvatar: function (dataUrl) {
      var current = this.current();
      if (!current) return { ok: false, message: '请先登录后再设置头像' };

      var users = Store.getUsers();
      var user = users.find(function (u) { return u.id === current.id; });
      if (!user) return { ok: false, message: '用户不存在，请重新登录后再试' };

      var value = String(dataUrl || '');
      user.avatar = value;
      try {
        Store.saveUsers(users);
      } catch (e) {
        return { ok: false, message: e.message || '保存头像失败，请重试' };
      }

      return { ok: true, message: value ? '头像已更新' : '头像已移除' };
    }
  };

  /* ======================================================================
   * 五、images 目录图片清单 + 自动生成 yg 的博客条目
   * ----------------------------------------------------------------------
   * 浏览器出于安全限制无法直接列出本地目录中的文件，因此这里「预先写好」清单：
   *   - 清单里的每一项对应 images 文件夹中的一张图片，一张图 = 一篇博客；
   *   - 图片文件名中的时间戳（wx_camera_<毫秒时间戳>.jpg）被解析为发布时间；
   *   - 每次打开首页都会执行同步：清单里新增的图片会自动生成新的 yg 博客；
   *
   * 【如何新增一篇 yg 的博客】
   *   1) 把图片放进 images 文件夹；
   *   2) 在下面 YG_IMAGES 数组中追加一行 { file: '文件名', time: 'YYYY-MM-DD HH:mm' }；
   *   3) 刷新首页即可看到新博客（无需改动其它代码）。
   *
   * 【如何自定义某张图片的标题/正文】
   *   在 YG_IMAGE_TEXT 中按文件名写一条覆盖配置即可。
   * ====================================================================== */

  /** images 目录内的图片清单（file：文件名；time：发布时间，取自文件名中的时间戳） */
  var YG_IMAGES = [
    { file: 'wx_camera_1755160979291.jpg', time: '2025-08-14 16:42' },
    { file: 'wx_camera_1755161002435.jpg', time: '2025-08-14 16:43' },
    { file: 'wx_camera_1755161021266.jpg', time: '2025-08-14 16:43' },
    { file: 'wx_camera_1755161040894.jpg', time: '2025-08-14 16:44' },
    { file: 'wx_camera_1755161058913.jpg', time: '2025-08-14 16:44' },
    { file: 'wx_camera_1755161074489.jpg', time: '2025-08-14 16:44' },
    { file: 'wx_camera_1755161086511.jpg', time: '2025-08-14 16:44' },
    { file: 'wx_camera_1755161106930.jpg', time: '2025-08-14 16:45' },
    { file: 'wx_camera_1755161120059.jpg', time: '2025-08-14 16:45' },
    { file: 'wx_camera_1755161151516.jpg', time: '2025-08-14 16:45' },
    { file: 'wx_camera_1755161162779.jpg', time: '2025-08-14 16:46' },
    { file: 'wx_camera_1755161177626.jpg', time: '2025-08-14 16:46' },
    { file: 'wx_camera_1755161195407.jpg', time: '2025-08-14 16:46' },
    { file: 'wx_camera_1755161208649.jpg', time: '2025-08-14 16:46' },
    { file: 'wx_camera_1755161224863.jpg', time: '2025-08-14 16:47' },
    { file: 'wx_camera_1755161235921.jpg', time: '2025-08-14 16:47' },
    { file: 'wx_camera_1755161258263.jpg', time: '2025-08-14 16:47' },
    { file: 'wx_camera_1755161268498.jpg', time: '2025-08-14 16:47' },
    { file: 'wx_camera_1755161283206.jpg', time: '2025-08-14 16:48' },
    { file: 'wx_camera_1755161293262.jpg', time: '2025-08-14 16:48' },
    { file: 'wx_camera_1755161320306.jpg', time: '2025-08-14 16:48' },
    { file: 'wx_camera_1755161342472.jpg', time: '2025-08-14 16:49' },
    { file: 'wx_camera_1755161356103.jpg', time: '2025-08-14 16:49' },
    { file: 'wx_camera_1755161380735.jpg', time: '2025-08-14 16:49' },
    { file: 'wx_camera_1755161397804.jpg', time: '2025-08-14 16:49' },
    { file: 'wx_camera_1755161413094.jpg', time: '2025-08-14 16:50' },
    { file: 'wx_camera_1755161426485.jpg', time: '2025-08-14 16:50' },
    { file: 'wx_camera_1755161436973.jpg', time: '2025-08-14 16:50' },
    { file: 'wx_camera_1755161452294.jpg', time: '2025-08-14 16:50' },
    { file: 'wx_camera_1755161463787.jpg', time: '2025-08-14 16:51' },
    { file: 'wx_camera_1755161477103.jpg', time: '2025-08-14 16:51' },
    { file: 'wx_camera_1755161490339.jpg', time: '2025-08-14 16:51' },
    { file: 'wx_camera_1755161505306.jpg', time: '2025-08-14 16:51' },
    { file: 'wx_camera_1755161516836.jpg', time: '2025-08-14 16:51' },
    { file: 'wx_camera_1755161530497.jpg', time: '2025-08-14 16:52' },
    { file: 'wx_camera_1755161543790.jpg', time: '2025-08-14 16:52' },
    { file: 'wx_camera_1755161561345.jpg', time: '2025-08-14 16:52' },
    { file: 'wx_camera_1755161575081.jpg', time: '2025-08-14 16:52' },
    { file: 'wx_camera_1755161587208.jpg', time: '2025-08-14 16:53' },
    { file: 'wx_camera_1755161602771.jpg', time: '2025-08-14 16:53' },
    { file: 'wx_camera_1755161620699.jpg', time: '2025-08-14 16:53' },
    { file: 'wx_camera_1755161630923.jpg', time: '2025-08-14 16:53' },
    { file: 'wx_camera_1755161646865.jpg', time: '2025-08-14 16:54' },
    { file: 'wx_camera_1755161660587.jpg', time: '2025-08-14 16:54' },
    { file: 'wx_camera_1755161779231.jpg', time: '2025-08-14 16:56' }
  ];

  /** 标题词库：按顺序循环使用，保证每篇标题不重复（序号自动追加） */
  var YG_TITLE_POOL = [
    '清晨的光', '路边的小景', '随手一拍', '街角偶遇', '午后的静谧',
    '走走停停', '寻常日子', '窗外的风景', '慢下来的时光', '定格的瞬间',
    '安静的角落', '路上的风景', '生活碎片', '光影之间', '日常记录'
  ];

  /** 正文词库：按索引组合两句话，形成各不相同的文字描述 */
  var YG_TEXT_POOL = [
    '今天出门散步时随手拍下的画面，光线刚好，就把它留了下来。',
    '没有刻意构图，只是觉得那一刻很舒服，于是按下了快门。',
    '生活里值得记住的往往都是这种很小的瞬间。',
    '天气不错，风也温柔，走走看看，心情就跟着松了下来。',
    '照片拍得一般，但当时的感受是真实的，所以想存一份。',
    '喜欢这种安静的时刻，不需要说话，看着就很治愈。',
    '同一处地方，换一个角度就有了不一样的样子。',
    '把平常的一天记录下来，回头看会很有意思。',
    '本来只是路过，结果停下来看了很久。',
    '这些细碎的日常，拼起来就是生活本身。',
    '阳光落在上面的时候，颜色比想象中更好看。',
    '没有什么特别的理由，单纯觉得好看就拍了。'
  ];

  /**
   * 可选的「手动覆盖」配置：按文件名自定义标题与正文。
   * 例如：
   *   wx_camera_1755160979291.jpg: { title: '我的第一篇博客', content: '正文内容…' }
   */
  var YG_IMAGE_TEXT = {
    // 'wx_camera_1755160979291.jpg': { title: '……', content: '……' }
  };

  /** 把「YYYY-MM-DD HH:mm」转成 ISO 字符串；解析失败则返回当前时间 */
  function parseTime(text) {
    var t = Date.parse(String(text).replace(' ', 'T') + ':00');
    return new Date(isNaN(t) ? Date.now() : t).toISOString();
  }

  /** 取出不含扩展名的文件名 */
  function stripExt(filename) {
    return String(filename).replace(/\.[^.]+$/, '');
  }

  /**
   * 依据图片清单为管理员 yg 生成博客条目
   * - 已存在的（id 相同）跳过，因此重复执行是安全的；
   * - 被手动删除过的条目记录在 removedPosts 中，不会自动复活。
   * @returns {number} 本次新增的博客数量
   */
  function syncYgPosts() {
    var posts = Store.getPosts();
    var removed = Store.getRemovedPosts();
    var existingIds = posts.map(function (p) { return p.id; });
    var added = 0;

    YG_IMAGES.forEach(function (item, index) {
      var id = 'yg-' + stripExt(item.file);
      if (existingIds.indexOf(id) !== -1) return;  // 已存在
      if (removed.indexOf(id) !== -1) return;      // 已被管理员删除，不再生成

      var override = YG_IMAGE_TEXT[item.file] || {};
      var title = override.title || (YG_TITLE_POOL[index % YG_TITLE_POOL.length] +
        ' · ' + String(index + 1).padStart(2, '0'));
      var content = override.content || (
        YG_TEXT_POOL[index % YG_TEXT_POOL.length] + '\n' +
        YG_TEXT_POOL[(index * 5 + 3) % YG_TEXT_POOL.length]
      );

      posts.push({
        id: id,
        title: title,
        content: content,
        image: 'images/' + item.file,   // 直接引用 images 目录中的原图
        author: ADMIN_USERNAME,
        authorRole: 'admin',
        source: 'seed',                 // seed = 由图片清单自动生成
        createdAt: parseTime(item.time)
      });
      added++;
    });

    if (added > 0) Store.savePosts(posts);
    return added;
  }

  /* ======================================================================
   * 六、博客模块
   * ====================================================================== */

  var Posts = {
    /**
     * 查询博客列表
     * @param {{keyword?:string, filter?:'all'|'yg'|'mine', viewer?:string, zoneOnly?:boolean}} options
     *        zoneOnly = true 时只返回「用户自己发布的博客」（用于用户博客专区）
     * @returns {Array} 按发布时间倒序排列的博客数组
     */
    list: function (options) {
      options = options || {};
      var keyword = String(options.keyword || '').trim().toLowerCase();
      var filter = options.filter || 'all';
      var viewer = options.viewer || '';
      var list = Store.getPosts();

      // 用户博客专区：只保留普通用户发布的博客，
      // 排除管理员 yg 发布的博客（含由 images 图片清单自动生成的图片随笔）
      if (options.zoneOnly) {
        list = list.filter(function (p) { return p.author !== ADMIN_USERNAME; });
      }

      // 关键词过滤：标题 / 正文 / 作者
      if (keyword) {
        list = list.filter(function (p) {
          return (p.title + '\n' + p.content + '\n' + p.author).toLowerCase().indexOf(keyword) !== -1;
        });
      }

      // 身份筛选
      if (filter === 'yg') {
        list = list.filter(function (p) { return p.author === ADMIN_USERNAME; });
      } else if (filter === 'mine') {
        list = list.filter(function (p) { return p.author === viewer; });
      }

      // 时间倒序：最新发布在最前面
      return list.sort(function (a, b) {
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
    },

    /** 按 id 取单篇博客 */
    get: function (id) {
      return Store.getPosts().find(function (p) { return p.id === id; }) || null;
    },

    /**
     * 发布博客（必须登录）
     * @param {{title:string, content:string, image?:string}} data
     * @returns {{ok:boolean, message:string, post?:Object}}
     */
    create: function (data) {
      var user = Auth.current();
      if (!user) return { ok: false, message: '请先登录后再发布博客' };

      var title = String((data && data.title) || '').trim();
      var content = String((data && data.content) || '').trim();
      var image = (data && data.image) || '';

      if (!title) return { ok: false, message: '请填写博客标题' };
      if (title.length > LIMITS.titleMax) {
        return { ok: false, message: '标题最多 ' + LIMITS.titleMax + ' 字' };
      }
      if (!content) return { ok: false, message: '请填写文字描述' };
      if (content.length > LIMITS.contentMax) {
        return { ok: false, message: '文字描述最多 ' + LIMITS.contentMax + ' 字' };
      }

      var post = {
        id: uid('p'),
        title: title,
        content: content,
        image: image,                       // 用户上传的图片以 dataURL 形式保存
        author: user.username,
        authorRole: user.role,
        source: 'user',
        createdAt: new Date().toISOString()
      };

      var list = Store.getPosts();
      list.push(post);
      try {
        Store.savePosts(list);            // 空间不足时抛出可读错误，在这里转为失败结果
      } catch (e) {
        return { ok: false, message: e.message || '保存失败，请重试' };
      }
      return { ok: true, message: '发布成功', post: post };
    },

    /**
     * 删除博客（作者本人或管理员），同时级联删除它的评论
     * @returns {{ok:boolean, message:string}}
     */
    remove: function (id) {
      var post = this.get(id);
      if (!post) return { ok: false, message: '博客不存在或已被删除' };
      if (!Auth.canDeletePost(post)) return { ok: false, message: '你没有权限删除这篇博客' };

      var list = Store.getPosts().filter(function (p) { return p.id !== id; });
      try {
        Store.savePosts(list);
      } catch (e) {
        return { ok: false, message: e.message || '删除失败，请重试' };
      }

      // 级联删除评论
      Comments.removeByPost(id);

      // 如果是图片清单生成的博客，记录下来，避免刷新后又被重新生成
      if (post.source === 'seed') {
        var removed = Store.getRemovedPosts();
        if (removed.indexOf(id) === -1) {
          removed.push(id);
          Store.saveRemovedPosts(removed);
        }
      }
      return { ok: true, message: '已删除该博客' };
    },

    /** 统计某作者发布的博客数量 */
    countByAuthor: function (username) {
      return Store.getPosts().filter(function (p) { return p.author === username; }).length;
    }
  };

  /* ======================================================================
   * 七、评论模块
   * ====================================================================== */

  var Comments = {
    /** 取某篇博客的评论（时间正序，最早的在上面） */
    listByPost: function (postId) {
      return Store.getComments()
        .filter(function (c) { return c.postId === postId; })
        .sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
    },

    /** 统计某篇博客的评论条数 */
    countByPost: function (postId) {
      return Store.getComments().filter(function (c) { return c.postId === postId; }).length;
    },

    /**
     * 发表评论（必须登录，仅支持纯文字）
     * @returns {{ok:boolean, message:string}}
     */
    create: function (postId, content) {
      var user = Auth.current();
      if (!user) return { ok: false, message: '请先登录后再评论' };

      content = String(content || '').trim();
      if (!content) return { ok: false, message: '评论内容不能为空' };
      if (content.length > LIMITS.commentMax) {
        return { ok: false, message: '评论最多 ' + LIMITS.commentMax + ' 字' };
      }
      if (!Posts.get(postId)) return { ok: false, message: '博客不存在，无法评论' };

      var list = Store.getComments();
      list.push({
        id: uid('c'),
        postId: postId,
        author: user.username,
        content: content,
        createdAt: new Date().toISOString()
      });
      try {
        Store.saveComments(list);
      } catch (e) {
        return { ok: false, message: e.message || '评论失败，请重试' };
      }
      return { ok: true, message: '评论成功' };
    },

    /**
     * 删除评论：评论作者本人 或 管理员
     * @returns {{ok:boolean, message:string}}
     */
    remove: function (commentId) {
      var user = Auth.current();
      if (!user) return { ok: false, message: '请先登录' };

      var list = Store.getComments();
      var target = list.find(function (c) { return c.id === commentId; });
      if (!target) return { ok: false, message: '评论不存在' };
      if (user.role !== 'admin' && user.username !== target.author) {
        return { ok: false, message: '只能删除自己的评论' };
      }

      try {
        Store.saveComments(list.filter(function (c) { return c.id !== commentId; }));
      } catch (e) {
        return { ok: false, message: e.message || '删除失败，请重试' };
      }
      return { ok: true, message: '已删除该评论' };
    },

    /** 删除某篇博客下的全部评论（随博客一起删除） */
    removeByPost: function (postId) {
      Store.saveComments(Store.getComments().filter(function (c) {
        return c.postId !== postId;
      }));
    }
  };

  /* ======================================================================
   * 七之二、意见反馈模块
   * ----------------------------------------------------------------------
   * 未登录也可提交；反馈保存在 localStorage，管理员可在管理后台查看。
   * ====================================================================== */

  var Feedback = {
    /** 反馈类型对应的中文名（同时也是合法类型白名单） */
    TYPE_LABELS: {
      suggestion: '功能建议',
      bug: '问题反馈',
      content: '内容纠错',
      other: '其他'
    },

    /** 取中文类型名，未知类型回退为「其他」 */
    typeLabel: function (type) {
      return this.TYPE_LABELS[type] || this.TYPE_LABELS.other;
    },

    /** 按时间倒序返回全部反馈（最新的在最前） */
    list: function () {
      return Store.getFeedback().slice().sort(function (a, b) {
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
    },

    /** 统计反馈条数 */
    count: function () {
      return Store.getFeedback().length;
    },

    /**
     * 新增一条反馈
     * @returns {{ok:boolean, message:string}}
     */
    add: function (type, content, contact) {
      content = String(content || '').trim();
      contact = String(contact || '').trim();

      if (!content) return { ok: false, message: '请填写反馈内容' };
      if (content.length > LIMITS.feedbackMax) {
        return { ok: false, message: '反馈内容最多 ' + LIMITS.feedbackMax + ' 字' };
      }
      if (contact.length > LIMITS.feedbackContactMax) {
        return { ok: false, message: '联系方式最多 ' + LIMITS.feedbackContactMax + ' 字' };
      }

      var user = Auth.current();
      var list = Store.getFeedback();
      list.push({
        id: uid('fb'),
        type: this.TYPE_LABELS[type] ? type : 'other',
        content: content,
        contact: contact,
        author: user ? user.username : '游客',
        createdAt: new Date().toISOString()
      });
      try {
        Store.saveFeedback(list);
      } catch (e) {
        return { ok: false, message: e.message || '提交失败，请重试' };
      }
      return { ok: true, message: '反馈已提交，感谢你的建议！' };
    },

    /** 删除一条反馈（仅管理员后台使用） */
    remove: function (id) {
      var list = Store.getFeedback();
      var found = list.some(function (f) { return f.id === id; });
      if (!found) return { ok: false, message: '反馈不存在，可能已被删除' };
      Store.saveFeedback(list.filter(function (f) { return f.id !== id; }));
      return { ok: true, message: '已删除该条反馈' };
    }
  };

  /* ======================================================================
   * 七之三、管理员博客文字覆盖（直接编辑 → 导出 JSON 提交到仓库）
   * ----------------------------------------------------------------------
   * 优先级：本地待提交编辑 > 仓库 data/admin-posts.json > js 内 YG_IMAGE_TEXT > 自动生成
   * 不使用任何令牌：编辑后下载 admin-posts.json，手动提交到仓库即可全站生效。
   * ====================================================================== */

  /** 仓库中的管理员博客文字覆盖文件（相对路径，部署在仓库根目录下） */
  var ADMIN_POSTS_URL = 'data/admin-posts.json';

  /** 本地编辑（尚未提交到仓库）的文字覆盖：{ [postId]: { title, content } } */
  var adminTextLocal = {};

  /** 从 data/admin-posts.json 读到的文字覆盖 */
  var adminTextRepo = {};

  /** 合并「仓库覆盖」与「本地编辑」，本地优先 */
  function mergedAdminText() {
    var out = {};
    var key;
    for (key in adminTextRepo) {
      if (Object.prototype.hasOwnProperty.call(adminTextRepo, key)) out[key] = adminTextRepo[key];
    }
    for (key in adminTextLocal) {
      if (Object.prototype.hasOwnProperty.call(adminTextLocal, key)) out[key] = adminTextLocal[key];
    }
    return out;
  }

  /** 覆盖条数（后台显示用） */
  function adminTextCount() {
    return Object.keys(mergedAdminText()).length;
  }

  /** 记录一条本地编辑（待提交到仓库） */
  function recordAdminText(postId, title, content) {
    adminTextLocal[postId] = { title: title, content: content };
    try { Store.saveAdminText(adminTextLocal); } catch (e) { /* 忽略配额问题 */ }
  }

  /** 把文字覆盖应用到博客数据（只作用于管理员 yg 的博客） */
  function applyAdminPostText(map) {
    map = map || {};
    var posts = Store.getPosts();
    var changed = false;
    posts.forEach(function (p) {
      if (p.author !== ADMIN_USERNAME) return;
      var ov = map[p.id];
      if (!ov) return;
      if (ov.title && ov.title !== p.title) { p.title = ov.title; changed = true; }
      if (ov.content && ov.content !== p.content) { p.content = ov.content; changed = true; }
    });
    if (changed) {
      try { Store.savePosts(posts); } catch (e) { /* 配额不足时忽略，仅本次展示失效 */ }
    }
  }

  /**
   * 读取文字覆盖：先读本地，再尝试读取仓库中的 data/admin-posts.json。
   * 用 file:// 直接打开或文件不存在时 fetch 会失败，此时静默忽略（只用本地编辑）。
   */
  function loadAdminPostText() {
    adminTextLocal = Store.getAdminText();
    return fetch(ADMIN_POSTS_URL, { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : {}; })
      .then(function (data) {
        adminTextRepo = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
      })
      .catch(function () { adminTextRepo = {}; })   // file:// / 无此文件时忽略
      .then(function () { applyAdminPostText(mergedAdminText()); });
  }

  /** 下载 data/admin-posts.json（供管理员手动提交到仓库） */
  function downloadAdminTextJson() {
    var json = JSON.stringify(mergedAdminText(), null, 2) + '\n';
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'admin-posts.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ------------------ 管理员博客文字编辑弹窗（全局） ------------------ */
  var textEditorPostId = null;

  /** 创建文字编辑弹窗结构（只创建一次） */
  function ensureTextEditorModal() {
    if (document.getElementById('textEditorModal')) return;

    var html = '' +
      '<div class="modal" id="textEditorModal">' +
      '<div class="modal__box">' +
      '<div class="modal__head">' +
      '<h3 class="modal__title">✏️ 编辑管理员博客文字</h3>' +
      '<button type="button" class="modal__close" id="teClose" aria-label="关闭">✕</button>' +
      '</div>' +
      '<div class="modal__body">' +
      '<div class="form-msg" id="teMsg"></div>' +
      '<p class="text-sub" style="margin-top:0">修改会立即在本机生效。到「管理后台 → 数据管理 → 下载 admin-posts.json」，' +
      '把它提交到仓库的 <code>data/admin-posts.json</code> 后，所有访客刷新即可看到。</p>' +
      '<div class="form-item"><label class="form-label" for="teTitle">标题</label>' +
      '<input class="input" id="teTitle" type="text" maxlength="' + LIMITS.titleMax + '" /></div>' +
      '<div class="form-item"><label class="form-label" for="teContent">正文</label>' +
      '<textarea class="textarea" id="teContent" maxlength="' + LIMITS.contentMax + '"></textarea></div>' +
      '</div>' +
      '<div class="modal__foot">' +
      '<button type="button" class="btn btn--ghost" id="teCancel">取消</button>' +
      '<button type="button" class="btn btn--primary" id="teSave">保存</button>' +
      '</div>' +
      '</div>' +
      '</div>';

    var node = htmlToElement(html);
    document.body.appendChild(node);

    document.getElementById('teClose').addEventListener('click', closeTextEditor);
    document.getElementById('teCancel').addEventListener('click', closeTextEditor);
    document.getElementById('teSave').addEventListener('click', saveTextEditor);
    node.addEventListener('click', function (e) { if (e.target === node) closeTextEditor(); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var m = document.getElementById('textEditorModal');
      if (m && m.classList.contains('is-show')) closeTextEditor();
    });
  }

  /** 打开文字编辑弹窗（仅管理员可编辑 yg 的博客） */
  function openTextEditor(postId) {
    var user = Auth.current();
    if (!user || user.role !== 'admin') { toast('只有管理员可以编辑管理员博客'); return; }

    var post = Posts.get(postId);
    if (!post) { toast('博客不存在，可能已被删除'); return; }
    if (post.author !== ADMIN_USERNAME) { toast('只能编辑管理员博客'); return; }

    ensureTextEditorModal();
    textEditorPostId = postId;
    showFormMsg(document.getElementById('teMsg'), '', '');
    document.getElementById('teTitle').value = post.title;
    document.getElementById('teContent').value = post.content;
    document.getElementById('textEditorModal').classList.add('is-show');
    document.getElementById('teTitle').focus();
  }

  /** 关闭文字编辑弹窗 */
  function closeTextEditor() {
    var m = document.getElementById('textEditorModal');
    if (m) m.classList.remove('is-show');
    textEditorPostId = null;
  }

  /** 保存文字编辑（写入本地并记录为「待提交」覆盖） */
  function saveTextEditor() {
    if (!textEditorPostId) return;
    var msg = document.getElementById('teMsg');
    var title = document.getElementById('teTitle').value.trim();
    var content = document.getElementById('teContent').value.trim();

    if (!title) { showFormMsg(msg, '标题不能为空', 'error'); return; }
    if (title.length > LIMITS.titleMax) { showFormMsg(msg, '标题最多 ' + LIMITS.titleMax + ' 字', 'error'); return; }
    if (!content) { showFormMsg(msg, '正文不能为空', 'error'); return; }
    if (content.length > LIMITS.contentMax) { showFormMsg(msg, '正文最多 ' + LIMITS.contentMax + ' 字', 'error'); return; }

    var posts = Store.getPosts();
    var post = posts.find(function (p) { return p.id === textEditorPostId; });
    if (!post) { showFormMsg(msg, '博客不存在，可能已被删除', 'error'); return; }

    post.title = title;
    post.content = content;
    try {
      Store.savePosts(posts);
    } catch (e) {
      showFormMsg(msg, e.message || '保存失败，请重试', 'error');
      return;
    }

    recordAdminText(post.id, title, content);
    closeTextEditor();
    toast('已保存。可到「管理后台 → 数据管理」下载 JSON 并提交到仓库');
    if (typeof pageRefresh === 'function') pageRefresh();
  }

  /* ======================================================================
   * 八、视图层
   * ====================================================================== */

  /** 首页每个分区默认显示的博客数量（点击「展开更多」按此步长递增） */
  var SECTION_PAGE_SIZE = 6;

  /** 首页两个分区的配置（id 与名称） */
  var HOME_SECTIONS = {
    admin: {
      listId: 'adminPostList',
      countId: 'adminCount',
      emptyId: 'adminEmpty',
      moreId: 'adminMore'
    },
    user: {
      listId: 'userPostListHome',
      countId: 'userCount',
      emptyId: 'userEmpty',
      moreId: 'userMore'
    }
  };

  /**
   * 首页筛选状态（只在首页用到）
   * limit：两个分区各自的显示上限，默认每区 6 篇，可「展开更多」
   */
  var homeState = {
    keyword: '',
    filter: 'all',
    limit: { admin: SECTION_PAGE_SIZE, user: SECTION_PAGE_SIZE }
  };

  /** 用户博客专区的筛选状态（只在 user.html 用到） */
  var zoneState = { keyword: '', filter: 'all' };

  /** 生成单篇博客详情页的链接：post.html?id=博客id */
  function postUrl(postId) {
    return 'post.html?id=' + encodeURIComponent(postId);
  }

  /** 生成某用户主页的链接：profile.html?name=用户名 */
  function profileUrl(username) {
    return 'profile.html?name=' + encodeURIComponent(username);
  }

  /**
   * 把头像 / 昵称等包成「进入该用户主页」的链接
   * @param {string} username 用户名
   * @param {string} inner    链接内部 HTML（通常是头像 + 昵称）
   */
  function profileLink(username, inner) {
    return '<a class="user-link" href="' + profileUrl(username) + '" title="查看 ' +
      escapeHtml(username) + ' 的主页">' + inner + '</a>';
  }

  /* ---------------------------- 8.1 公共导航 ---------------------------- */
  function renderNav() {
    var nav = document.getElementById('nav');
    if (!nav) return;
    var user = Auth.current();
    var html = '';

    html += '<a class="btn btn--ghost" href="index.html">首页</a>';
    html += '<a class="btn btn--ghost" href="user.html">用户专区</a>';

    if (user) {
      html += '<a class="btn btn--primary" href="publish.html">发布博客</a>';
      // 只有管理员能看到「管理后台」入口（可视化管理员 mg.html）
      if (user.role === 'admin') {
        html += '<a class="btn btn--ghost" href="mg.html">管理后台</a>';
      }
      html += '<a class="nav__user" href="' + profileUrl(user.username) + '" ' +
        'title="查看我的主页">' +
        avatarHtml(user.username, 'sm') +
        '<span class="nav__name">' + escapeHtml(user.username) +
        (user.role === 'admin' ? ' <span class="badge-admin">管理员</span>' : '') +
        '</span>' +
        '</a>';
      html += '<button type="button" class="btn btn--ghost" data-action="logout">退出登录</button>';
    } else {
      html += '<a class="btn btn--ghost" href="login.html">登录</a>';
      html += '<a class="btn btn--primary" href="register.html">注册</a>';
    }

    nav.innerHTML = html;
  }

  /**
   * 退出登录（document 级事件委托，全页只绑定一次）
   * 说明：renderNav() 会被重复调用（如改头像后），若在其内部绑定监听会越绑越多，
   *      因此把退出登录交给只执行一次的委托处理。
   */
  function initNavActions() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action="logout"]');
      if (!btn) return;
      Auth.logout();
      toast('已退出登录');
      setTimeout(function () { window.location.reload(); }, 400);
    });
  }

  /* ---------------------------- 8.2 首页渲染 ---------------------------- */
  /** 生成单张卡片（博客 + 评论区）的 HTML */
  function buildPostCard(post) {
    var user = Auth.current();
    var isAdmin = !!user && user.role === 'admin';
    var isOwner = !!user && user.username === post.author;
    var canDeletePost = isAdmin || isOwner;

    var comments = Comments.listByPost(post.id);
    var longText = post.content.length > 200;

    var html = '';
    html += '<article class="card" data-post-id="' + escapeHtml(post.id) + '">';

    // 封面图（点击可放大）
    if (post.image) {
      html += '<img class="card__cover" src="' + escapeHtml(post.image) + '" alt="' +
        escapeHtml(post.title) + '" loading="lazy" data-action="zoom" />';
    }

    html += '<div class="card__body">';
    // 标题可点击，进入单篇博客详情页 post.html?id=xxx
    html += '<h2 class="card__title"><a href="' + postUrl(post.id) + '">' +
      escapeHtml(post.title) + '</a></h2>';

    // 元信息：作者（头像/昵称可点击进入主页） + 发布时间 + 评论数
    html += '<div class="card__meta">';
    html += '<span class="meta-user">' +
      profileLink(post.author, avatarHtml(post.author, 'sm') + ' ' + escapeHtml(post.author));
    if (post.author === ADMIN_USERNAME) html += ' <span class="badge-admin">管理员</span>';
    else if (post.authorRole === 'user') html += ' <span class="badge-author">用户</span>';
    html += '</span>';
    html += '<span>🕒 ' + escapeHtml(formatTime(post.createdAt)) + '</span>';
    html += '<span>💬 ' + comments.length + ' 条评论</span>';
    html += '</div>';

    // 正文（超长自动折叠）
    html += '<p class="card__text' + (longText ? ' is-clamped' : '') + '">' +
      escapeHtml(post.content) + '</p>';
    if (longText) {
      html += '<div><button type="button" class="link-btn" data-action="toggle-text">展开全文</button></div>';
    }

    html += '<div class="card__actions">';
    if (canDeletePost) {
      html += '<button type="button" class="btn btn--danger" data-action="delete-post">删除博客</button>';
    }
    if (isAdmin && post.author === ADMIN_USERNAME) {
      html += '<button type="button" class="link-btn" data-action="edit-post-text">✏️ 编辑文字</button>';
    }
    html += '<a class="link-btn" href="' + postUrl(post.id) + '">阅读全文 →</a>';
    html += '<span class="spacer"></span>';
    if (!user) {
      html += '<span class="text-sub" style="font-size:13px">登录后可评论</span>';
    }
    html += '</div>';

    // 评论区（与详情页共用同一套渲染逻辑）
    html += buildCommentsHtml(post);

    html += '</div>'; // .card__body
    html += '</article>';
    return html;
  }

  /**
   * 生成某篇博客的完整评论区 HTML（首页卡片与详情页共用）
   * @param {Object} post 博客对象
   * @returns {string}
   */
  function buildCommentsHtml(post) {
    var user = Auth.current();
    var isAdmin = !!user && user.role === 'admin';
    var comments = Comments.listByPost(post.id);

    var html = '';
    html += '<div class="comments">';
    html += '<p class="comments__title">评论区（' + comments.length + '）</p>';
    html += '<ul class="comment-list">';

    if (comments.length === 0) {
      html += '<li class="text-sub" style="font-size:13px">还没有评论，来说两句吧～</li>';
    } else {
      comments.forEach(function (c) {
        var canDeleteComment = isAdmin || (user && user.username === c.author);
        html += '<li class="comment-item">';
        html += '<div class="comment-item__head">';
        html += '<span class="comment-item__author">' +
          profileLink(c.author, avatarHtml(c.author, 'sm') + ' ' + escapeHtml(c.author)) + '</span>';
        html += '<span>' + escapeHtml(formatTime(c.createdAt)) + '</span>';
        html += '<span class="spacer"></span>';
        if (canDeleteComment) {
          html += '<button type="button" class="link-btn" data-action="delete-comment" data-comment-id="' +
            escapeHtml(c.id) + '">删除</button>';
        }
        html += '</div>';
        html += '<p class="comment-item__content">' + escapeHtml(c.content) + '</p>';
        html += '</li>';
      });
    }
    html += '</ul>';

    // 评论输入（未登录时隐藏输入框，提示去登录）
    if (user) {
      html += '<div class="comment-form">';
      html += '<input class="input" type="text" maxlength="' + LIMITS.commentMax +
        '" placeholder="写下你的评论…" data-role="comment-input" />';
      html += '<button type="button" class="btn btn--primary" data-action="submit-comment">发表评论</button>';
      html += '</div>';
    } else {
      html += '<p class="text-sub" style="font-size:13px"><a href="login.html">登录</a> 后即可发表文字评论。</p>';
    }

    html += '</div>'; // .comments
    return html;
  }

  /**
   * 按当前搜索/筛选条件取出博客，并按作者分成两个分区
   * @returns {{all:Array, admin:Array, user:Array}}
   */
  function getHomeData() {
    var user = Auth.current();
    var all = Posts.list({
      keyword: homeState.keyword,
      filter: homeState.filter,
      viewer: user ? user.username : ''
    });

    return {
      all: all,
      // 管理员 yg 的博客 → 「管理员博客」分区（图片随笔 + yg 手动发布的）
      admin: all.filter(function (p) { return p.author === ADMIN_USERNAME; }),
      // 其余作者的博客 → 「用户博客」分区
      user: all.filter(function (p) { return p.author !== ADMIN_USERNAME; })
    };
  }

  /**
   * 渲染首页的某一个分区（列表 + 数量 + 空状态 + 展开更多按钮）
   * @param {string} key   'admin' | 'user'
   * @param {Array}  posts 该分区的博客数组（已过滤、已排序）
   */
  function renderHomeSection(key, posts) {
    var cfg = HOME_SECTIONS[key];
    var listEl = document.getElementById(cfg.listId);
    if (!listEl) return;

    // 搜索时把所有匹配结果都展示出来；否则按分区上限分批显示
    var searching = !!homeState.keyword;
    var visible = searching ? posts : posts.slice(0, homeState.limit[key]);

    listEl.innerHTML = visible.map(buildPostCard).join('');

    // 该分区的空状态
    var emptyEl = document.getElementById(cfg.emptyId);
    if (emptyEl) emptyEl.classList.toggle('hidden', posts.length > 0);

    // 该分区的数量统计
    var countEl = document.getElementById(cfg.countId);
    if (countEl) {
      if (posts.length === 0) {
        countEl.textContent = '暂无内容';
      } else if (visible.length < posts.length) {
        countEl.textContent = '共 ' + posts.length + ' 篇（已显示 ' + visible.length + ' 篇）';
      } else {
        countEl.textContent = '共 ' + posts.length + ' 篇';
      }
    }

    // 「展开更多 / 收起」按钮
    var moreEl = document.getElementById(cfg.moreId);
    if (!moreEl) return;
    moreEl.innerHTML = '';

    if (searching || posts.length <= SECTION_PAGE_SIZE) return;

    var canExpand = homeState.limit[key] < posts.length;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--ghost';
    btn.setAttribute('data-action', 'section-toggle');
    btn.setAttribute('data-section', key);
    btn.textContent = canExpand
      ? '展开更多（还有 ' + (posts.length - visible.length) + ' 篇）'
      : '收起';
    moreEl.appendChild(btn);
  }

  /** 统计当前条件下某个分区的博客总数 */
  function countSectionPosts(key) {
    return getHomeData()[key].length;
  }

  /** 渲染首页（管理员博客 + 用户博客两个分区） */
  function renderHome() {
    var listEl = document.getElementById(HOME_SECTIONS.admin.listId);
    if (!listEl) return;   // 当前不是首页

    var data = getHomeData();
    renderHomeSection('admin', data.admin);
    renderHomeSection('user', data.user);

    // 顶部工具条的总体统计
    var countEl = document.getElementById('postCount');
    if (countEl) {
      var user = Auth.current();
      countEl.textContent = '共 ' + data.all.length + ' 篇博客' +
        '（管理员 ' + data.admin.length + ' · 用户 ' + data.user.length + '）' +
        (user ? '（当前登录：' + user.username + '）' : '');
    }

    // 左侧目录栏里的分区数量
    var sideAdmin = document.getElementById('sideAdminCount');
    if (sideAdmin) sideAdmin.textContent = data.admin.length;
    var sideUser = document.getElementById('sideUserCount');
    if (sideUser) sideUser.textContent = data.user.length;
  }

  /**
   * 为「博客容器」绑定交互（首页卡片列表与详情页共用）
   * @param {HTMLElement} rootEl 承载博客 DOM 的容器
   * @param {Function} refresh  数据变化后的重新渲染回调
   */
  function bindPostInteractions(rootEl, refresh) {
    if (!rootEl) return;

    rootEl.addEventListener('click', function (e) {
      // 当前操作的博客块：首页是 .card，详情页是 .post-detail，两者都带 data-post-id
      var scope = e.target.closest('[data-post-id]') || rootEl;
      var postId = scope.getAttribute('data-post-id');

      // 图片放大
      if (e.target.closest('[data-action="zoom"]')) {
        openLightbox(e.target.closest('[data-action="zoom"]').src);
        return;
      }

      // 编辑管理员博客文字（仅管理员，且只针对 yg 的博客）
      if (e.target.closest('[data-action="edit-post-text"]')) {
        openTextEditor(postId);
        return;
      }

      // 展开 / 收起正文（仅首页卡片有折叠）
      var toggleBtn = e.target.closest('[data-action="toggle-text"]');
      if (toggleBtn) {
        var textEl = scope.querySelector('.card__text');
        if (!textEl) return;
        var clamped = textEl.classList.toggle('is-clamped');
        toggleBtn.textContent = clamped ? '展开全文' : '收起';
        return;
      }

      // 发表评论
      if (e.target.closest('[data-action="submit-comment"]')) {
        var input = scope.querySelector('[data-role="comment-input"]');
        var result = Comments.create(postId, input ? input.value : '');
        if (!result.ok) { toast(result.message); return; }
        if (input) input.value = '';
        toast(result.message);
        refresh();             // 重新渲染，评论立即出现
        return;
      }

      // 删除评论
      var delCommentBtn = e.target.closest('[data-action="delete-comment"]');
      if (delCommentBtn) {
        if (!window.confirm('确定删除这条评论吗？')) return;
        var res = Comments.remove(delCommentBtn.getAttribute('data-comment-id'));
        toast(res.message);
        if (res.ok) refresh();
        return;
      }

      // 删除博客
      if (e.target.closest('[data-action="delete-post"]')) {
        if (!window.confirm('确定删除这篇博客吗？删除后其评论也会一并移除。')) return;
        var r = Posts.remove(postId);
        toast(r.message);
        if (!r.ok) return;

        // 详情页删了当前博客就没有内容可看，直接回首页
        if (document.body.getAttribute('data-page') === 'post') {
          setTimeout(function () { window.location.href = 'index.html'; }, 600);
        } else {
          refresh();
        }
        return;
      }
    });

    // 评论输入框按回车直接提交
    rootEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var input = e.target.closest('[data-role="comment-input"]');
      if (!input) return;
      e.preventDefault();
      var scope = input.closest('[data-post-id]') || rootEl;
      var btn = scope.querySelector('[data-action="submit-comment"]');
      if (btn) btn.click();
    });
  }

  /** 初始化首页的搜索框与筛选按钮 */
  function initHomeFilters() {
    /** 搜索/筛选条件变化时，把两个分区的展开状态重置回默认 6 篇 */
    function resetLimits() {
      homeState.limit = { admin: SECTION_PAGE_SIZE, user: SECTION_PAGE_SIZE };
    }

    var searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        homeState.keyword = searchInput.value;
        resetLimits();
        renderHome();
      });
    }

    var group = document.getElementById('filterGroup');
    if (!group) return;
    group.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-filter]');
      if (!btn) return;

      var filter = btn.getAttribute('data-filter');
      // 「我的博客」需要先登录
      if (filter === 'mine' && !Auth.isLoggedIn()) {
        toast('请先登录后查看「我的博客」');
        setTimeout(function () { window.location.href = 'login.html'; }, 800);
        return;
      }

      homeState.filter = filter;
      resetLimits();
      Array.prototype.forEach.call(group.querySelectorAll('button'), function (b) {
        b.classList.toggle('is-active', b === btn);
      });
      renderHome();
    });
  }

  /** 首页分区的「展开更多 / 收起」交互（事件委托绑定在分区容器上） */
  function initHomeSections() {
    Object.keys(HOME_SECTIONS).forEach(function (key) {
      var sectionEl = document.getElementById(key + 'Section');
      if (!sectionEl) return;

      sectionEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-action="section-toggle"]');
        if (!btn) return;

        var total = countSectionPosts(key);
        // 已全部展开 → 收起；否则再多显示一批
        homeState.limit[key] = homeState.limit[key] >= total
          ? SECTION_PAGE_SIZE
          : homeState.limit[key] + SECTION_PAGE_SIZE;
        renderHome();
      });
    });
  }

  /* ---------------------- 8.3 用户博客专区（user.html） --------------------- */
  // 专区只展示「用户通过发布页创作的博客」（source === 'user'）；
  // yg 由 images 图片清单自动生成的图片随笔不在这里，仍在首页展示。

  /**
   * 生成专区顶部的用户提示卡（未登录 / 已登录未发布 / 已登录已发布，三种文案）
   * @returns {string} HTML
   */
  function buildZoneTipHtml() {
    var user = Auth.current();

    // 1) 未登录：提示先登录，并给出去向按钮
    if (!user) {
      var total = Posts.list({ zoneOnly: true }).length;
      return '' +
        '<div class="callout callout--warn">' +
        '<span class="callout__icon">🔒</span>' +
        '<div class="callout__body">' +
        '<p class="callout__title">你还未登录</p>' +
        '<p class="callout__text">专区现有 ' + total +
        ' 篇用户博客。登录后即可发布自己的图文博客，也能给别人的博客留言。</p>' +
        '</div>' +
        '<div class="callout__actions">' +
        '<a class="btn btn--primary" href="login.html">去登录</a>' +
        '<a class="btn btn--ghost" href="register.html">注册新账号</a>' +
        '</div>' +
        '</div>';
    }

    // 2) 已登录：告知已发布数量与后续可做的操作
    var mine = Posts.list({ zoneOnly: true, filter: 'mine', viewer: user.username }).length;
    var tipText = mine === 0
      ? '你还没有在专区发布过博客，点击右侧按钮写下第一篇吧。'
      : '你已在专区发布 ' + mine + ' 篇博客，可继续发布，也可以删除自己的博客与评论。';

    return '' +
      '<div class="callout">' +
      '<span class="callout__icon callout__avatar">' +
      profileLink(user.username, avatarHtml(user.username, 'lg')) + '</span>' +
      '<div class="callout__body">' +
      '<p class="callout__title">欢迎你，' + profileLink(user.username, escapeHtml(user.username)) + '！</p>' +
      '<p class="callout__text">' + tipText + '</p>' +
      '</div>' +
      '<div class="callout__actions">' +
      '<a class="btn btn--primary" href="publish.html">发布我的博客</a>' +
      '<button type="button" class="btn btn--ghost" data-action="edit-avatar">更换头像</button>' +
      (mine > 0 ? '<button type="button" class="btn btn--ghost" data-action="zone-mine">查看我的博客</button>' : '') +
      '</div>' +
      '</div>';
  }

  /** 渲染用户博客专区列表 */
  function renderUserZone() {
    var listEl = document.getElementById('userPostList');
    if (!listEl) return;

    var user = Auth.current();
    var posts = Posts.list({
      keyword: zoneState.keyword,
      filter: zoneState.filter,
      viewer: user ? user.username : '',
      zoneOnly: true
    });

    listEl.innerHTML = posts.map(buildPostCard).join('');

    // 空状态
    var emptyEl = document.getElementById('emptyState');
    if (emptyEl) emptyEl.classList.toggle('hidden', posts.length > 0);

    // 统计信息
    var countEl = document.getElementById('postCount');
    if (countEl) {
      countEl.textContent = zoneState.filter === 'mine'
        ? '我的博客：' + posts.length + ' 篇'
        : '专区共 ' + posts.length + ' 篇用户博客';
    }

    // 顶部提示卡随登录状态与数据变化一起刷新
    var tipEl = document.getElementById('userZoneTip');
    if (tipEl) tipEl.innerHTML = buildZoneTipHtml();
  }

  /** 切换专区筛选并同步按钮高亮 */
  function setZoneFilter(filter) {
    zoneState.filter = filter;
    var group = document.getElementById('zoneFilterGroup');
    if (!group) return;
    Array.prototype.forEach.call(group.querySelectorAll('button'), function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-filter') === filter);
    });
  }

  /** 初始化用户博客专区页 */
  function initUserZonePage() {
    var searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        zoneState.keyword = searchInput.value;
        renderUserZone();
      });
    }

    var group = document.getElementById('zoneFilterGroup');
    if (group) {
      group.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-filter]');
        if (!btn) return;

        var filter = btn.getAttribute('data-filter');
        // 「我的博客」需要先登录
        if (filter === 'mine' && !Auth.isLoggedIn()) {
          toast('请先登录后查看「我的博客」');
          setTimeout(function () { window.location.href = 'login.html'; }, 800);
          return;
        }

        setZoneFilter(filter);
        renderUserZone();
      });
    }

    // 提示卡里的「查看我的博客」按钮
    var tipEl = document.getElementById('userZoneTip');
    if (tipEl) {
      tipEl.addEventListener('click', function (e) {
        if (!e.target.closest('[data-action="zone-mine"]')) return;
        setZoneFilter('mine');
        renderUserZone();
        toast('已切换到「我的博客」');
      });
    }
  }

  /** 首页专区横幅的提示文案（按登录状态变化） */
  function updateZoneBanner() {
    var el = document.getElementById('zoneBannerTip');
    if (!el) return;

    var user = Auth.current();
    var total = Posts.list({ zoneOnly: true }).length;

    if (!user) {
      el.textContent = '专区已有 ' + total + ' 篇用户博客。登录后即可发布你自己的图文博客（发布与评论均需登录）。';
      return;
    }

    var mine = Posts.list({ zoneOnly: true, filter: 'mine', viewer: user.username }).length;
    el.textContent = '已登录 ' + user.username + '，专区现有 ' + total +
      ' 篇用户博客，你已发布 ' + mine + ' 篇。';
  }

  /* ------------- 8.4 左侧目录栏（管理员博客 / 用户博客） ------------- */
  /** 目录栏要跳转/高亮的两个分区 id */
  var SIDEBAR_TARGETS = ['adminSection', 'userSection'];

  /** 按当前滚动位置高亮目录栏中对应的分区 */
  function updateSidebarActive() {
    var nav = document.getElementById('sidebarNav');
    if (!nav) return;

    // 取「已经滚过顶部」的最后一个分区作为当前分区
    var current = SIDEBAR_TARGETS[0];
    SIDEBAR_TARGETS.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (el.getBoundingClientRect().top <= 130) current = id;
    });

    // 已经滚到页面底部时（最后一个分区可能顶不到顶部），直接高亮最后一个分区
    var atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    if (atBottom) current = SIDEBAR_TARGETS[SIDEBAR_TARGETS.length - 1];

    Array.prototype.forEach.call(nav.querySelectorAll('.sidebar__item'), function (item) {
      item.classList.toggle('is-active', item.getAttribute('data-target') === current);
    });
  }

  /** 初始化左侧目录栏：点击平滑滚动到分区 + 滚动时自动高亮 */
  function initSidebar() {
    var nav = document.getElementById('sidebarNav');
    if (!nav) return;

    nav.addEventListener('click', function (e) {
      var item = e.target.closest('.sidebar__item');
      if (!item) return;

      e.preventDefault();   // 改用 JS 平滑滚动，避免瞬间跳转
      var target = document.getElementById(item.getAttribute('data-target'));
      if (!target) return;

      target.scrollIntoView({ behavior: 'smooth', block: 'start' });

      // 点击后立即高亮，避免等滚动结束才变
      Array.prototype.forEach.call(nav.querySelectorAll('.sidebar__item'), function (b) {
        b.classList.toggle('is-active', b === item);
      });
    });

    // 滚动监听（requestAnimationFrame 节流）
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () {
        updateSidebarActive();
        ticking = false;
      });
    });

    updateSidebarActive();
  }

  /* ------------------- 8.5 单篇博客详情页（post.html?id=xxx） ------------------ */
  /** 从地址栏中读取 ?id= 参数 */
  function getQueryId() {
    var match = window.location.search.match(/[?&]id=([^&]*)/);
    if (!match) return '';
    try { return decodeURIComponent(match[1]); }
    catch (e) { return match[1]; }   // 非法编码不报错，交给「未找到博客」空状态处理
  }

  /**
   * 生成详情页 HTML：大图 + 标题 + 发布人/时间 + 完整正文 + 评论区 + 上一篇/下一篇
   * @param {Object} post 博客对象
   */
  function buildPostDetail(post) {
    var user = Auth.current();
    var isAdmin = !!user && user.role === 'admin';
    var isOwner = !!user && user.username === post.author;
    var comments = Comments.listByPost(post.id);

    // 上一篇 / 下一篇：列表已按时间倒序，index+1 为更早发布的一篇
    var all = Posts.list({ filter: 'all' });
    var index = all.findIndex(function (p) { return p.id === post.id; });
    var prevPost = index > 0 ? all[index - 1] : null;  // 更新的一篇
    var nextPost = (index !== -1 && index < all.length - 1) ? all[index + 1] : null; // 更早的一篇

    var html = '';
    html += '<article class="post-detail" data-post-id="' + escapeHtml(post.id) + '">';
    html += '<p class="post-detail__breadcrumb"><a href="index.html">← 返回博客首页</a></p>';
    html += '<h1 class="post-detail__title">' + escapeHtml(post.title) + '</h1>';

    // 元信息：作者（头像/昵称可点击进入主页） + 发布时间 + 评论数
    html += '<div class="card__meta">';
    html += '<span class="meta-user">' +
      profileLink(post.author, avatarHtml(post.author, 'sm') + ' ' + escapeHtml(post.author));
    if (post.author === ADMIN_USERNAME) html += ' <span class="badge-admin">管理员</span>';
    else if (post.authorRole === 'user') html += ' <span class="badge-author">用户</span>';
    html += '</span>';
    html += '<span>🕒 ' + escapeHtml(formatTime(post.createdAt)) + '</span>';
    html += '<span>💬 ' + comments.length + ' 条评论</span>';
    html += '</div>';

    // 大图（点击可放大）
    if (post.image) {
      html += '<img class="post-detail__cover" src="' + escapeHtml(post.image) +
        '" alt="' + escapeHtml(post.title) + '" data-action="zoom" />';
    }

    // 完整正文（详情页不折叠，保留换行）
    html += '<div class="post-detail__content">' + escapeHtml(post.content) + '</div>';

    // 操作区：作者本人或管理员可删除；管理员可直接编辑管理员博客的文字
    html += '<div class="card__actions">';
    if (isAdmin || isOwner) {
      html += '<button type="button" class="btn btn--danger" data-action="delete-post">删除博客</button>';
    }
    if (isAdmin && post.author === ADMIN_USERNAME) {
      html += '<button type="button" class="link-btn" data-action="edit-post-text">✏️ 编辑文字</button>';
    }
    html += '<span class="spacer"></span>';
    if (!user) {
      html += '<span class="text-sub" style="font-size:13px">登录后可评论</span>';
    }
    html += '</div>';

    // 评论区（与首页卡片共用渲染逻辑）
    html += buildCommentsHtml(post);

    // 上一篇 / 下一篇导航
    html += '<nav class="post-nav">';
    html += nextPost
      ? '<a href="' + postUrl(nextPost.id) + '">← 上一篇：' + escapeHtml(nextPost.title) + '</a>'
      : '<span class="post-nav__placeholder">已经是第一篇了</span>';
    html += prevPost
      ? '<a href="' + postUrl(prevPost.id) + '">下一篇：' + escapeHtml(prevPost.title) + ' →</a>'
      : '<span class="post-nav__placeholder">已经是最后一篇了</span>';
    html += '</nav>';

    html += '</article>';
    return html;
  }

  /** 渲染详情页（根据地址栏 id 找博客，找不到则显示空状态） */
  function renderPostPage() {
    var el = document.getElementById('postDetail');
    if (!el) return;

    var post = Posts.get(getQueryId());
    var emptyEl = document.getElementById('emptyState');

    if (!post) {
      el.innerHTML = '';
      if (emptyEl) emptyEl.classList.remove('hidden');
      document.title = '未找到博客 · ' + SITE_NAME;
      return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');
    el.innerHTML = buildPostDetail(post);
    document.title = post.title + ' · ' + SITE_NAME;  // 浏览器标签显示当前博客标题
    window.scrollTo(0, 0);
  }

  /* ---------------------------- 8.6.1 用户主页 ---------------------------- */
  /** 读取地址栏 ?name=用户名 */
  function getQueryName() {
    var match = window.location.search.match(/[?&]name=([^&]*)/);
    if (!match) return '';
    try { return decodeURIComponent(match[1]); }
    catch (e) { return match[1]; }   // 非法编码不报错，交给「未找到用户」空状态处理
  }

  /** 渲染用户主页：用户信息卡（含真实姓名） + TA 的博客列表 */
  function renderProfilePage() {
    var cardEl = document.getElementById('profileCard');
    if (!cardEl) return;

    var name = getQueryName();
    var user = findUserByName(name);
    var listEl = document.getElementById('profilePostList');
    var emptyEl = document.getElementById('profileEmpty');
    var countEl = document.getElementById('profilePostCount');
    var descEl = document.getElementById('profilePostDesc');
    var titleEl = document.getElementById('profilePostTitle');
    var emptyTextEl = document.getElementById('profileEmptyText');

    // 用户不存在
    if (!user) {
      document.title = '用户不存在 · ' + SITE_NAME;
      cardEl.innerHTML = '<div class="empty">' +
        '<div class="empty__icon">🔍</div>' +
        '<p>没有找到该用户</p>' +
        '<p class="text-sub" style="font-size:13px">用户可能已被删除，或链接有误。</p>' +
        '<div class="empty__actions"><a class="btn btn--primary" href="index.html">返回首页</a></div>' +
        '</div>';
      if (listEl) listEl.innerHTML = '';
      if (emptyEl) emptyEl.classList.add('hidden');
      if (countEl) countEl.textContent = '';
      if (descEl) descEl.textContent = '';
      return;
    }

    document.title = user.username + ' 的主页 · ' + SITE_NAME;

    var me = Auth.current();
    var isSelf = !!me && me.username.toLowerCase() === user.username.toLowerCase();
    var postCount = Posts.countByAuthor(user.username);
    var commentCount = Store.getComments().filter(function (c) {
      return c.author === user.username;
    }).length;

    // 真实姓名：一般在别处不展示，只有进入该用户主页时才能看到
    var realName = user.realName
      ? '<strong>' + escapeHtml(user.realName) + '</strong>'
      : '<span class="text-sub">未填写</span>';

    var roleBadge = user.role === 'admin'
      ? ' <span class="badge-admin">管理员</span>'
      : ' <span class="badge-author">用户</span>';

    cardEl.innerHTML = '' +
      '<div class="profile-card">' +
      '<div class="profile-card__avatar">' + avatarHtml(user.username, 'lg') + '</div>' +
      '<div class="profile-card__info">' +
      '<h1 class="profile-card__name">' + escapeHtml(user.username) + roleBadge + '</h1>' +
      '<p class="profile-card__row"><span class="profile-card__label">真实姓名</span>' + realName + '</p>' +
      '<p class="profile-card__row"><span class="profile-card__label">注册时间</span>' +
      escapeHtml(formatTime(user.createdAt)) + '</p>' +
      '<p class="profile-card__row"><span class="profile-card__label">博客 / 评论</span>' +
      postCount + ' 篇 / ' + commentCount + ' 条</p>' +
      '</div>' +
      (isSelf
        ? '<div class="profile-card__actions">' +
        '<a class="btn btn--primary" href="publish.html">发布博客</a>' +
        '<button type="button" class="btn btn--ghost" data-action="edit-avatar">更换头像</button>' +
        '</div>'
        : '') +
      '</div>';

    // 该用户发布的博客（时间倒序）
    var posts = Posts.list({ filter: 'all' }).filter(function (p) {
      return p.author === user.username;
    });

    if (descEl) descEl.textContent = isSelf ? '这里是你发布过的全部博客。' : 'TA 发布的全部博客。';
    if (titleEl) titleEl.textContent = isSelf ? '📄 我的博客' : '📄 TA 的博客';
    if (emptyTextEl) emptyTextEl.textContent = isSelf ? '你还没有发布过博客' : 'TA 还没有发布过博客';
    if (countEl) countEl.textContent = '共 ' + posts.length + ' 篇';

    if (!listEl) return;
    listEl.innerHTML = posts.map(buildPostCard).join('');
    if (emptyEl) emptyEl.classList.toggle('hidden', posts.length > 0);
  }

  /** 初始化用户主页 */
  function initProfilePage() {
    bindPostInteractions(document.getElementById('profilePostList'), renderProfilePage);
    pageRefresh = renderProfilePage;
    renderProfilePage();
    window.scrollTo(0, 0);
  }

  /* ---------------------------- 8.6 图片放大 ---------------------------- */
  function openLightbox(src) {
    var box = document.getElementById('lightbox');
    if (!box) return;
    box.innerHTML = '<img src="' + escapeHtml(src) + '" alt="预览图" />';
    box.classList.add('is-show');
  }

  function initLightbox() {
    var box = document.getElementById('lightbox');
    if (!box) return;
    box.addEventListener('click', function () {
      box.classList.remove('is-show');
      box.innerHTML = '';
    });
  }

  /* ---------------------------- 8.7 登录页 ---------------------------- */
  function initLoginPage() {
    var form = document.getElementById('loginForm');
    if (!form) return;
    var msg = document.getElementById('formMsg');

    // 已登录用户直接回首页
    if (Auth.isLoggedIn()) {
      showFormMsg(msg, '你已登录，正在返回首页…', 'success');
      setTimeout(function () { window.location.href = 'index.html'; }, 600);
      return;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var username = form.username.value;
      var password = form.password.value;
      var result = Auth.login(username, password);
      if (!result.ok) { showFormMsg(msg, result.message, 'error'); return; }

      showFormMsg(msg, result.message + '，正在跳转…', 'success');
      toast(result.message);
      setTimeout(function () { window.location.href = 'index.html'; }, 600);
    });
  }

  /* ---------------------------- 8.8 注册页 ---------------------------- */
  function initRegisterPage() {
    var form = document.getElementById('registerForm');
    if (!form) return;
    var msg = document.getElementById('formMsg');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var result = Auth.register(
        form.username.value,
        form.password.value,
        form.password2.value,
        form.realname.value
      );
      if (!result.ok) { showFormMsg(msg, result.message, 'error'); return; }

      showFormMsg(msg, result.message + '，正在跳转首页…', 'success');
      toast(result.message);
      setTimeout(function () { window.location.href = 'index.html'; }, 700);
    });
  }

  /* ---------------------------- 8.9 发布页 ---------------------------- */
  function initPublishPage() {
    var form = document.getElementById('publishForm');
    if (!form) return;

    var msg = document.getElementById('formMsg');
    var fileInput = document.getElementById('image');
    var preview = document.getElementById('filePreview');
    var counter = document.getElementById('contentCounter');
    var submitBtn = document.getElementById('submitBtn');

    // 未登录不允许发博客
    if (!Auth.canPublish()) {
      showFormMsg(msg, '请先登录后再发布博客，正在跳转登录页…', 'error');
      submitBtn.disabled = true;
      setTimeout(function () { window.location.href = 'login.html'; }, 1200);
      return;
    }

    // 字数统计
    form.content.addEventListener('input', function () {
      if (counter) counter.textContent = form.content.value.length + ' / ' + LIMITS.contentMax;
    });

    // 选择图片后立即本地预览
    var pendingImage = '';
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      pendingImage = '';
      if (!file) { preview.classList.add('hidden'); preview.innerHTML = ''; return; }

      compressImage(file).then(function (dataUrl) {
        pendingImage = dataUrl;
        preview.classList.remove('hidden');
        preview.innerHTML = '<img src="' + escapeHtml(dataUrl) + '" alt="图片预览" />';
      }).catch(function (err) {
        preview.classList.add('hidden');
        preview.innerHTML = '';
        fileInput.value = '';
        showFormMsg(msg, err.message, 'error');
      });
    });

    // 提交发布
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      showFormMsg(msg, '', '');

      // 用户选图但压缩还没结束时，提示稍候
      if (fileInput.files && fileInput.files[0] && !pendingImage) {
        showFormMsg(msg, '图片正在处理中，请稍候再点发布', 'error');
        return;
      }

      var result = Posts.create({
        title: form.title.value,
        content: form.content.value,
        image: pendingImage
      });

      if (!result.ok) { showFormMsg(msg, result.message, 'error'); return; }

      showFormMsg(msg, result.message + '，正在返回…', 'success');
      toast(result.message);

      // 普通用户发布后回到「用户博客专区」，管理员发布后回首页
      var target = Auth.isAdmin() ? 'index.html' : 'user.html';
      setTimeout(function () { window.location.href = target; }, 700);
    });
  }

  /* ------------------- 8.10 管理后台（mg.html · 可视化管理员） ------------------ */
  // 权限：仅管理员 yg（role === 'admin'）可进入，普通用户会看到「无权限」提示。
  // 能力：查看统计数据；修改 / 删除任意用户（级联清理其博客与评论）；
  //      修改 / 删除任意博客；修改 / 删除任意评论；导出 / 导入 / 清空全部数据。
  // 注意：纯前端项目没有真正的安全边界，这里的权限校验只是界面层拦截，仅用于演示。

  /** 管理后台的数据操作集合 */
  var Mg = {
    /** 当前登录用户是否有后台权限 */
    canUse: function () { return Auth.isAdmin(); },

    /** 站点统计（顶部统计卡片用） */
    stats: function () {
      var users = Store.getUsers();
      var posts = Store.getPosts();
      var comments = Store.getComments();
      var feedback = Store.getFeedback();

      // 粗略估算 localStorage 占用（按字符数）
      var chars = 0;
      [STORAGE_KEY.users, STORAGE_KEY.posts, STORAGE_KEY.comments,
      STORAGE_KEY.session, STORAGE_KEY.removedPosts, STORAGE_KEY.feedback].forEach(function (key) {
        var value = localStorage.getItem(key);
        if (value) chars += value.length;
      });

      return {
        users: users.length,
        admins: users.filter(function (u) { return u.role === 'admin'; }).length,
        posts: posts.length,
        seedPosts: posts.filter(function (p) { return p.source === 'seed'; }).length,
        userPosts: posts.filter(function (p) { return p.author !== ADMIN_USERNAME; }).length,
        comments: comments.length,
        feedback: feedback.length,
        sizeKB: (chars / 1024).toFixed(1)
      };
    },

    /**
     * 修改用户：用户名 / 密码（留空表示不修改）/ 角色
     * - 管理员 yg 的用户名与角色受保护；
     * - 用户名变更时会同步更新其博客与评论中的作者名。
     */
    updateUser: function (id, data) {
      var users = Store.getUsers();
      var user = users.find(function (u) { return u.id === id; });
      if (!user) return { ok: false, message: '用户不存在，可能已被删除' };

      var username = String((data && data.username) || '').trim();
      var password = String((data && data.password) || '');
      var realName = String((data && data.realName) || '').trim();
      var role = (data && data.role) === 'admin' ? 'admin' : 'user';

      if (!username) return { ok: false, message: '用户名不能为空' };
      if (username.length < LIMITS.usernameMin || username.length > LIMITS.usernameMax) {
        return { ok: false, message: '用户名长度需为 ' + LIMITS.usernameMin + '-' + LIMITS.usernameMax + ' 位' };
      }
      if (realName && (realName.length < LIMITS.realNameMin || realName.length > LIMITS.realNameMax)) {
        return { ok: false, message: '真实姓名长度需为 ' + LIMITS.realNameMin + '-' + LIMITS.realNameMax + ' 个字' };
      }
      if (password && password.length < LIMITS.passwordMin) {
        return { ok: false, message: '新密码至少 ' + LIMITS.passwordMin + ' 位' };
      }

      // 管理员 yg 保护
      if (user.username === ADMIN_USERNAME) {
        if (username !== ADMIN_USERNAME) return { ok: false, message: '管理员 yg 的用户名不允许修改' };
        if (role !== 'admin') return { ok: false, message: '管理员 yg 不能被降级为普通用户' };
      } else if (username.toLowerCase() === ADMIN_USERNAME) {
        return { ok: false, message: '“' + ADMIN_USERNAME + '”是管理员保留用户名' };
      }

      // 重名检查
      var duplicated = users.some(function (u) {
        return u.id !== id && u.username.toLowerCase() === username.toLowerCase();
      });
      if (duplicated) return { ok: false, message: '已存在同名用户，请换一个用户名' };

      var oldName = user.username;
      user.username = username;
      user.role = role;
      if (realName) user.realName = realName;   // 留空表示不修改
      if (password) {
        user.password = simpleHash(password);
        user.passwordPlain = password;   // 同步明文密码，供后台查看
      }
      Store.saveUsers(users);

      // 用户名变化：同步其博客与评论的作者名
      if (oldName !== username) {
        var posts = Store.getPosts();
        var postChanged = false;
        posts.forEach(function (p) {
          if (p.author === oldName) { p.author = username; p.authorRole = role; postChanged = true; }
        });
        if (postChanged) Store.savePosts(posts);

        var comments = Store.getComments();
        var commentChanged = false;
        comments.forEach(function (c) {
          if (c.author === oldName) { c.author = username; commentChanged = true; }
        });
        if (commentChanged) Store.saveComments(comments);

        // 改的是当前登录用户时，同步登录状态
        var session = Store.getSession();
        if (session && session.username === oldName) {
          Store.saveSession({ username: username, loginAt: session.loginAt });
        }
      }

      return { ok: true, message: '已保存用户「' + username + '」的修改' };
    },

    /** 删除用户，并级联删除其博客与评论（管理员 yg 不可删除） */
    removeUser: function (id) {
      var users = Store.getUsers();
      var user = users.find(function (u) { return u.id === id; });
      if (!user) return { ok: false, message: '用户不存在，可能已被删除' };
      if (user.username === ADMIN_USERNAME) {
        return { ok: false, message: '管理员 yg 是系统账号，不可删除' };
      }

      // 1) 删除用户
      Store.saveUsers(users.filter(function (u) { return u.id !== id; }));

      // 2) 级联删除该用户的博客
      var posts = Store.getPosts();
      var ownedPostIds = posts
        .filter(function (p) { return p.author === user.username; })
        .map(function (p) { return p.id; });
      Store.savePosts(posts.filter(function (p) { return p.author !== user.username; }));

      // 3) 级联删除该用户的评论（含被删博客下的所有评论）
      Store.saveComments(Store.getComments().filter(function (c) {
        return c.author !== user.username && ownedPostIds.indexOf(c.postId) === -1;
      }));

      // 4) 删掉的正好是当前登录用户 → 退出登录
      var session = Store.getSession();
      if (session && session.username === user.username) Store.clearSession();

      return {
        ok: true,
        message: '已删除用户「' + user.username + '」及其 ' + ownedPostIds.length + ' 篇博客与相关评论'
      };
    },

    /** 修改博客的标题与正文 */
    updatePost: function (id, data) {
      var posts = Store.getPosts();
      var post = posts.find(function (p) { return p.id === id; });
      if (!post) return { ok: false, message: '博客不存在，可能已被删除' };

      var title = String((data && data.title) || '').trim();
      var content = String((data && data.content) || '').trim();

      if (!title) return { ok: false, message: '标题不能为空' };
      if (title.length > LIMITS.titleMax) return { ok: false, message: '标题最多 ' + LIMITS.titleMax + ' 字' };
      if (!content) return { ok: false, message: '文字描述不能为空' };
      if (content.length > LIMITS.contentMax) {
        return { ok: false, message: '文字描述最多 ' + LIMITS.contentMax + ' 字' };
      }

      post.title = title;
      post.content = content;
      Store.savePosts(posts);
      // 管理员博客（yg）的文字改动记录到「待提交」覆盖表，便于导出后同步到仓库
      if (post.author === ADMIN_USERNAME) recordAdminText(post.id, title, content);
      return { ok: true, message: '已保存博客「' + title + '」的修改' };
    },

    /** 修改评论内容 */
    updateComment: function (id, content) {
      var comments = Store.getComments();
      var comment = comments.find(function (c) { return c.id === id; });
      if (!comment) return { ok: false, message: '评论不存在，可能已被删除' };

      content = String(content || '').trim();
      if (!content) return { ok: false, message: '评论内容不能为空' };
      if (content.length > LIMITS.commentMax) {
        return { ok: false, message: '评论最多 ' + LIMITS.commentMax + ' 字' };
      }

      comment.content = content;
      Store.saveComments(comments);
      return { ok: true, message: '已保存评论的修改' };
    },

    /** 导出全部数据为 JSON 文件（浏览器下载） */
    exportData: function () {
      var data = {
        site: SITE_NAME,
        version: 1,
        exportedAt: new Date().toISOString(),
        users: Store.getUsers(),
        posts: Store.getPosts(),
        comments: Store.getComments(),
        removedPosts: Store.getRemovedPosts(),
        feedback: Store.getFeedback()
      };

      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'gzn16-data-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

      return { ok: true, message: '数据已导出为 JSON 文件' };
    },

    /** 导入 JSON 数据（覆盖当前全部数据，导入后需要重新登录） */
    importData: function (text) {
      var data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        return { ok: false, message: '文件不是合法的 JSON 格式' };
      }

      if (!data || !Array.isArray(data.users) || !Array.isArray(data.posts)) {
        return { ok: false, message: '数据格式不正确（至少需要 users 与 posts 两个数组）' };
      }

      Store.saveUsers(data.users);
      Store.savePosts(data.posts);
      Store.saveComments(Array.isArray(data.comments) ? data.comments : []);
      Store.saveRemovedPosts(Array.isArray(data.removedPosts) ? data.removedPosts : []);
      Store.saveFeedback(Array.isArray(data.feedback) ? data.feedback : []);

      // 导入后原登录信息可能已失效，统一退出登录
      Store.clearSession();
      return { ok: true, message: '数据导入成功，请重新登录管理员账号' };
    },

    /** 清空所有数据（刷新后会自动重建管理员 yg 与图片随笔） */
    clearAll: function () {
      var s = this.stats();
      try {
        localStorage.clear();
      } catch (e) {
        return { ok: false, message: '清空失败，请手动清理浏览器数据' };
      }
      return { ok: true, message: '已清空 ' + s.users + ' 个用户、' + s.posts + ' 篇博客、' + s.comments + ' 条评论、' + s.feedback + ' 条反馈' };
    }
  };

  /* ---------------------------- 8.10.1 后台视图 ---------------------------- */

  /** 后台当前页签与弹窗提交回调 */
  var mgState = { tab: 'users' };
  var mgModalSubmit = null;

  /** 统计卡片 */
  function renderMgStats() {
    var el = document.getElementById('mgStats');
    if (!el) return;

    var s = Mg.stats();
    var cards = [
      { label: '注册用户', value: s.users, sub: '其中管理员 ' + s.admins + ' 个' },
      { label: '博客总数', value: s.posts, sub: '自动生成 ' + s.seedPosts + ' · 手动/用户 ' + (s.posts - s.seedPosts) },
      { label: '评论总数', value: s.comments, sub: '全部为文字评论' },
      { label: '用户反馈', value: s.feedback, sub: '用户在意见反馈窗口提交' },
      { label: '本地占用', value: s.sizeKB + ' KB', sub: 'localStorage 上限约 5MB' }
    ];

    el.innerHTML = cards.map(function (c) {
      return '<div class="mg-stat">' +
        '<p class="mg-stat__value">' + escapeHtml(String(c.value)) + '</p>' +
        '<p class="mg-stat__label">' + escapeHtml(c.label) + '</p>' +
        '<p class="mg-stat__sub">' + escapeHtml(c.sub) + '</p>' +
        '</div>';
    }).join('');
  }

  /** 用户管理表格 */
  function renderMgUsers() {
    var users = Store.getUsers().slice().sort(function (a, b) {
      if (a.username === ADMIN_USERNAME) return -1;   // 管理员置顶
      if (b.username === ADMIN_USERNAME) return 1;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
    var posts = Store.getPosts();
    var comments = Store.getComments();

    var rows = users.map(function (u) {
      var isRoot = u.username === ADMIN_USERNAME;
      var postCount = posts.filter(function (p) { return p.author === u.username; }).length;
      var commentCount = comments.filter(function (c) { return c.author === u.username; }).length;

      // 真实姓名：注册时必填；历史账号可能为空
      var realName = u.realName
        ? escapeHtml(u.realName)
        : '<span class="text-sub">未填写</span>';

      // 密码：明文保存仅供后台查看（历史账号可能没有记录）
      var pwd = u.passwordPlain
        ? '<span class="pwd-text" data-plain="' + escapeHtml(u.passwordPlain) +
        '" data-shown="0">••••••</span>' +
        '<button type="button" class="link-btn" data-action="mg-toggle-pwd">显示</button>'
        : '<span class="text-sub">未记录</span>';

      return '<tr>' +
        '<td><span class="meta-user">' + avatarHtml(u.username, 'sm') +
        ' <strong>' + escapeHtml(u.username) + '</strong></span> ' +
        (u.role === 'admin' ? '<span class="badge-admin">管理员</span>' : '<span class="badge-author">用户</span>') +
        '</td>' +
        '<td>' + realName + '</td>' +
        '<td class="pwd-cell">' + pwd + '</td>' +
        '<td>' + escapeHtml(formatTime(u.createdAt)) + '</td>' +
        '<td>' + postCount + '</td>' +
        '<td>' + commentCount + '</td>' +
        '<td><div class="table__actions">' +
        '<button type="button" class="btn btn--ghost" data-action="mg-edit-user" data-id="' +
        escapeHtml(u.id) + '">编辑</button>' +
        '<button type="button" class="btn btn--danger" data-action="mg-del-user" data-id="' +
        escapeHtml(u.id) + '"' + (isRoot ? ' disabled title="管理员 yg 是系统账号，不可删除"' : '') +
        '>删除</button>' +
        '</div></td>' +
        '</tr>';
    }).join('');

    return '<div class="table-wrap"><table class="table table--wide">' +
      '<thead><tr><th>用户名</th><th>真实姓名</th><th>密码</th><th>注册时间</th><th>博客</th><th>评论</th><th>操作</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<p class="text-sub" style="font-size:13px">提示：修改用户名会同步更新该用户所有博客和评论显示的作者名；删除用户会连带删除其博客与评论。<br>' +
      '密码以明文保存在浏览器本地，仅供管理员在后台查看（演示用途，请勿用于真实生产环境）。</p>';
  }

  /** 博客管理表格 */
  function renderMgPosts() {
    var posts = Posts.list({ filter: 'all' });

    var rows = posts.map(function (p) {
      var commentCount = Comments.countByPost(p.id);
      return '<tr>' +
        '<td><a href="' + postUrl(p.id) + '" target="_blank" rel="noopener">' +
        escapeHtml(p.title) + '</a>' +
        '<div class="table__sub">' + escapeHtml(p.content.slice(0, 40)) +
        (p.content.length > 40 ? '…' : '') + '</div></td>' +
        '<td>' + escapeHtml(p.author) + '</td>' +
        '<td>' + escapeHtml(formatTime(p.createdAt)) + '</td>' +
        '<td>' + commentCount + '</td>' +
        '<td>' + (p.source === 'seed' ? '图片自动生成' : '用户发布') + '</td>' +
        '<td><div class="table__actions">' +
        '<button type="button" class="btn btn--ghost" data-action="mg-edit-post" data-id="' +
        escapeHtml(p.id) + '">编辑</button>' +
        '<button type="button" class="btn btn--danger" data-action="mg-del-post" data-id="' +
        escapeHtml(p.id) + '">删除</button>' +
        '</div></td>' +
        '</tr>';
    }).join('');

    return '<div class="table-wrap"><table class="table">' +
      '<thead><tr><th>标题 / 摘要</th><th>作者</th><th>发布时间</th><th>评论</th><th>来源</th><th>操作</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  /** 评论管理表格 */
  function renderMgComments() {
    var comments = Store.getComments().slice().sort(function (a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    if (comments.length === 0) {
      return '<div class="empty"><div class="empty__icon">💬</div><p>还没有任何评论</p></div>';
    }

    var rows = comments.map(function (c) {
      var post = Posts.get(c.postId);
      return '<tr>' +
        '<td>' + escapeHtml(c.content) + '</td>' +
        '<td>' + escapeHtml(c.author) + '</td>' +
        '<td>' + (post
          ? '<a href="' + postUrl(post.id) + '" target="_blank" rel="noopener">' + escapeHtml(post.title) + '</a>'
          : '<span class="text-sub">（博客已删除）</span>') + '</td>' +
        '<td>' + escapeHtml(formatTime(c.createdAt)) + '</td>' +
        '<td><div class="table__actions">' +
        '<button type="button" class="btn btn--ghost" data-action="mg-edit-comment" data-id="' +
        escapeHtml(c.id) + '">编辑</button>' +
        '<button type="button" class="btn btn--danger" data-action="mg-del-comment" data-id="' +
        escapeHtml(c.id) + '">删除</button>' +
        '</div></td>' +
        '</tr>';
    }).join('');

    return '<div class="table-wrap"><table class="table">' +
      '<thead><tr><th>评论内容</th><th>评论者</th><th>所属博客</th><th>时间</th><th>操作</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  /** 反馈管理页签 */
  function renderMgFeedback() {
    var list = Feedback.list();

    if (!list.length) {
      return '<div class="empty">' +
        '<div class="empty__icon">📮</div>' +
        '<p>还没有收到任何反馈</p>' +
        '<p class="text-sub" style="font-size:13px">用户可通过页面右下角的「意见反馈」按钮提交建议。</p>' +
        '</div>';
    }

    var rows = list.map(function (f) {
      return '<tr>' +
        '<td><span class="badge-author">' + escapeHtml(Feedback.typeLabel(f.type)) + '</span></td>' +
        '<td class="feedback-cell">' + escapeHtml(f.content) + '</td>' +
        '<td>' + escapeHtml(f.author) + '</td>' +
        '<td>' + (f.contact ? escapeHtml(f.contact) : '<span class="text-sub">—</span>') + '</td>' +
        '<td>' + escapeHtml(formatTime(f.createdAt)) + '</td>' +
        '<td><div class="table__actions">' +
        '<button type="button" class="btn btn--danger" data-action="mg-del-feedback" data-id="' +
        escapeHtml(f.id) + '">删除</button>' +
        '</div></td>' +
        '</tr>';
    }).join('');

    return '<div class="table-wrap"><table class="table">' +
      '<thead><tr><th>类型</th><th>反馈内容</th><th>提交者</th><th>联系方式</th><th>提交时间</th><th>操作</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<p class="text-sub" style="font-size:13px">共 ' + list.length + ' 条反馈。用户提交的反馈保存在浏览器本地，删除后无法恢复。</p>';
  }

  /** 数据管理页签 */
  function renderMgData() {
    var s = Mg.stats();
    return '' +
      '<div class="mg-block">' +
      '<h3 class="mg-block__title">📤 导出数据</h3>' +
      '<p class="mg-block__text">把当前浏览器里的全部数据（' + s.users + ' 个用户、' + s.posts +
      ' 篇博客、' + s.comments + ' 条评论、' + s.feedback + ' 条反馈）导出为 JSON 文件，便于备份或换设备继续使用。</p>' +
      '<button type="button" class="btn btn--primary" data-action="mg-export">导出 JSON 文件</button>' +
      '</div>' +

      '<div class="mg-block">' +
      '<h3 class="mg-block__title">📥 导入数据</h3>' +
      '<p class="mg-block__text">选择之前导出的 JSON 文件，用它<strong>覆盖</strong>当前全部数据；导入后会退出登录，需要重新登录。</p>' +
      '<input type="file" id="mgImportFile" accept=".json,application/json" class="hidden" />' +
      '<button type="button" class="btn btn--ghost" data-action="mg-import">选择文件并导入</button>' +
      '</div>' +

      '<div class="mg-block">' +
      '<h3 class="mg-block__title">📝 管理员博客文字 · 同步到仓库</h3>' +
      '<p class="mg-block__text">你在页面上（或本后台）编辑过的管理员博客（yg 的图片随笔）文字会记录在这里，' +
      '共 <strong>' + adminTextCount() + '</strong> 条覆盖。下载下面的 JSON，把它提交到仓库的 ' +
      '<code>data/admin-posts.json</code>（覆盖原文件），所有访客刷新后即可看到更新，无需后端。</p>' +
      '<button type="button" class="btn btn--primary" data-action="mg-download-admintext">下载 admin-posts.json</button>' +
      '</div>' +

      '<div class="mg-block mg-block--danger">' +
      '<h3 class="mg-block__title">🧹 清空数据</h3>' +
      '<p class="mg-block__text">删除全部用户、博客、评论与反馈（当前占用约 ' + s.sizeKB +
      ' KB）。刷新后会自动重新生成管理员 yg 与 ' + YG_IMAGES.length + ' 篇图片随笔。</p>' +
      '<button type="button" class="btn btn--danger" data-action="mg-clear">清空所有数据</button>' +
      '</div>';
  }

  /** 渲染当前页签内容 */
  function renderMgView() {
    var view = document.getElementById('mgView');
    if (!view) return;

    switch (mgState.tab) {
      case 'posts':
        view.innerHTML = renderMgPosts();
        break;
      case 'comments':
        view.innerHTML = renderMgComments();
        break;
      case 'feedback':
        view.innerHTML = renderMgFeedback();
        break;
      case 'data':
        view.innerHTML = renderMgData();
        break;
      case 'users':
      default:
        view.innerHTML = renderMgUsers();
        break;
    }

    syncMgTabs();
  }

  /** 同步后台页签的高亮状态（首次进入也保持选中，不留白） */
  function syncMgTabs() {
    var tabs = document.getElementById('mgTabs');
    if (!tabs) return;
    Array.prototype.forEach.call(tabs.querySelectorAll('.mg-tab'), function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-tab') === mgState.tab);
    });
  }

  /** 后台数据变化后统一刷新 */
  function refreshMg() {
    renderMgStats();
    renderMgView();
  }

  /* ---------------------------- 8.10.2 编辑弹窗 ---------------------------- */

  /** 生成一个表单字段的 HTML */
  function mgField(label, id, value, type, hint) {
    var control = type === 'textarea'
      ? '<textarea class="textarea" id="' + id + '">' + escapeHtml(value) + '</textarea>'
      : '<input class="input" id="' + id + '" type="' + (type || 'text') + '" value="' + escapeHtml(value) + '" />';
    return '<div class="form-item">' +
      '<label class="form-label" for="' + id + '">' + escapeHtml(label) + '</label>' +
      control + (hint ? '<p class="form-hint">' + escapeHtml(hint) + '</p>' : '') +
      '</div>';
  }

  /** 打开编辑弹窗 */
  function openMgModal(title, fieldsHtml, onSubmit) {
    var modal = document.getElementById('mgModal');
    if (!modal) return;

    document.getElementById('mgModalTitle').textContent = title;
    document.getElementById('mgModalFields').innerHTML = fieldsHtml;
    showFormMsg(document.getElementById('mgModalMsg'), '', '');
    mgModalSubmit = onSubmit;
    modal.classList.add('is-show');
  }

  /** 关闭编辑弹窗 */
  function closeMgModal() {
    var modal = document.getElementById('mgModal');
    if (modal) modal.classList.remove('is-show');
    mgModalSubmit = null;
  }

  /** 点击「保存修改」：执行回调，失败则在弹窗内提示 */
  function submitMgModal() {
    if (!mgModalSubmit) return;

    var result;
    try {
      result = mgModalSubmit();
    } catch (err) {
      result = { ok: false, message: err.message || '操作失败' };
    }

    if (!result || !result.ok) {
      showFormMsg(document.getElementById('mgModalMsg'), result ? result.message : '操作失败', 'error');
      return;
    }

    closeMgModal();
    toast(result.message);
    refreshMg();
  }

  /** 打开用户编辑弹窗 */
  function openMgUserEditor(id) {
    var user = Store.getUsers().find(function (u) { return u.id === id; });
    if (!user) { toast('用户不存在，可能已被删除'); refreshMg(); return; }

    var isRoot = user.username === ADMIN_USERNAME;
    var fields = mgField('用户名', 'mgUserName', user.username,
      'text', isRoot ? '管理员 yg 的用户名不可修改' : '修改后会同步更新其博客与评论的作者名') +
      mgField('真实姓名', 'mgRealName', user.realName || '', 'text',
        '用户的真实姓名，仅在用户主页与本管理后台显示') +
      mgField('新密码', 'mgUserPwd', '', 'text',
        isRoot ? '留空表示不修改（管理员密码可用于登录后台）' : '留空表示不修改密码，填写则至少 6 位') +
      '<div class="form-item"><label class="form-label" for="mgUserRole">角色</label>' +
      '<select class="input" id="mgUserRole"' + (isRoot ? ' disabled' : '') + '>' +
      '<option value="user"' + (user.role === 'user' ? ' selected' : '') + '>普通用户</option>' +
      '<option value="admin"' + (user.role === 'admin' ? ' selected' : '') + '>管理员</option>' +
      '</select>' +
      (isRoot ? '<p class="form-hint">管理员 yg 的角色不可修改</p>' : '') +
      '</div>';

    openMgModal('编辑用户：' + user.username, fields, function () {
      return Mg.updateUser(id, {
        username: document.getElementById('mgUserName').value,
        realName: document.getElementById('mgRealName').value,
        password: document.getElementById('mgUserPwd').value,
        role: isRoot ? 'admin' : document.getElementById('mgUserRole').value
      });
    });
  }

  /** 打开博客编辑弹窗 */
  function openMgPostEditor(id) {
    var post = Posts.get(id);
    if (!post) { toast('博客不存在，可能已被删除'); refreshMg(); return; }

    var fields = mgField('博客标题', 'mgPostTitle', post.title) +
      mgField('文字描述', 'mgPostContent', post.content, 'textarea');

    openMgModal('编辑博客', fields, function () {
      return Mg.updatePost(id, {
        title: document.getElementById('mgPostTitle').value,
        content: document.getElementById('mgPostContent').value
      });
    });
  }

  /** 打开评论编辑弹窗 */
  function openMgCommentEditor(id) {
    var comment = Store.getComments().find(function (c) { return c.id === id; });
    if (!comment) { toast('评论不存在，可能已被删除'); refreshMg(); return; }

    var fields = mgField('评论内容', 'mgCommentContent', comment.content, 'textarea');

    openMgModal('编辑评论（' + comment.author + '）', fields, function () {
      return Mg.updateComment(id, document.getElementById('mgCommentContent').value);
    });
  }

  /* ---------------------------- 8.10.3 后台初始化 ---------------------------- */

  /** 初始化管理后台页 */
  function initMgPage() {
    var panel = document.getElementById('mgPanel');
    if (!panel) return;

    var msg = document.getElementById('mgMsg');
    var forbidden = document.getElementById('mgForbidden');

    // 1) 未登录：提示并跳转登录页
    if (!Auth.isLoggedIn()) {
      showFormMsg(msg, '管理后台需要管理员登录，正在跳转登录页…', 'error');
      setTimeout(function () { window.location.href = 'login.html'; }, 1200);
      return;
    }

    // 2) 已登录但不是管理员：显示无权限提示
    if (!Mg.canUse()) {
      if (forbidden) forbidden.classList.remove('hidden');
      return;
    }

    // 3) 管理员：显示后台主体
    panel.classList.remove('hidden');
    refreshMg();

    // 页签切换
    var tabs = document.getElementById('mgTabs');
    if (tabs) {
      tabs.addEventListener('click', function (e) {
        var btn = e.target.closest('.mg-tab');
        if (!btn) return;
        mgState.tab = btn.getAttribute('data-tab');
        Array.prototype.forEach.call(tabs.querySelectorAll('.mg-tab'), function (b) {
          b.classList.toggle('is-active', b === btn);
        });
        renderMgView();
      });
    }

    // 表格内的操作按钮（事件委托）
    var view = document.getElementById('mgView');
    if (view) {
      view.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-action]');
        if (!btn) return;
        var action = btn.getAttribute('data-action');
        var id = btn.getAttribute('data-id');

        // 编辑
        if (action === 'mg-edit-user') return openMgUserEditor(id);
        if (action === 'mg-edit-post') return openMgPostEditor(id);
        if (action === 'mg-edit-comment') return openMgCommentEditor(id);

        // 显示 / 隐藏某用户的明文密码
        if (action === 'mg-toggle-pwd') {
          var cell = btn.closest('td');
          var textEl = cell ? cell.querySelector('.pwd-text') : null;
          if (!textEl) return;
          var shown = textEl.getAttribute('data-shown') === '1';
          if (shown) {
            textEl.textContent = '••••••';
            textEl.setAttribute('data-shown', '0');
            btn.textContent = '显示';
          } else {
            textEl.textContent = textEl.getAttribute('data-plain');
            textEl.setAttribute('data-shown', '1');
            btn.textContent = '隐藏';
          }
          return;
        }

        // 删除用户
        if (action === 'mg-del-user') {
          var target = Store.getUsers().find(function (u) { return u.id === id; });
          if (!target) { toast('用户不存在'); refreshMg(); return; }
          if (!window.confirm('确定删除用户「' + target.username + '」吗？\n其发布的博客与评论也会一并删除，且无法恢复。')) return;
          var r = Mg.removeUser(id);
          toast(r.message);
          if (r.ok) { refreshMg(); if (!Auth.isLoggedIn()) setTimeout(function () { window.location.href = 'index.html'; }, 900); }
          return;
        }

        // 删除博客
        if (action === 'mg-del-post') {
          if (!window.confirm('确定删除这篇博客吗？其下的评论也会一并删除。')) return;
          var rp = Posts.remove(id);
          toast(rp.message);
          if (rp.ok) refreshMg();
          return;
        }

        // 删除评论
        if (action === 'mg-del-comment') {
          if (!window.confirm('确定删除这条评论吗？')) return;
          var rc = Comments.remove(id);
          toast(rc.message);
          if (rc.ok) refreshMg();
          return;
        }

        // 删除反馈
        if (action === 'mg-del-feedback') {
          if (!window.confirm('确定删除这条反馈吗？删除后无法恢复。')) return;
          var rf = Feedback.remove(id);
          toast(rf.message);
          if (rf.ok) refreshMg();
          return;
        }

        // 导出 / 导入 / 清空
        if (action === 'mg-export') {
          var re = Mg.exportData();
          toast(re.message);
          return;
        }
        if (action === 'mg-import') {
          var fileInput = document.getElementById('mgImportFile');
          if (fileInput) fileInput.click();
          return;
        }
        if (action === 'mg-clear') {
          if (!window.confirm('确定清空所有数据吗？\n用户、博客、评论将全部删除（刷新后会重建管理员 yg 与图片随笔）。')) return;
          var rclear = Mg.clearAll();
          toast(rclear.message);
          if (rclear.ok) setTimeout(function () { window.location.href = 'index.html'; }, 1000);
          return;
        }

        // 下载管理员博客文字覆盖文件（手动提交到仓库）
        if (action === 'mg-download-admintext') {
          downloadAdminTextJson();
          toast('已下载 admin-posts.json，请提交到仓库 data/ 目录');
          return;
        }
      });

      // 导入文件选择
      view.addEventListener('change', function (e) {
        var input = e.target.closest('#mgImportFile');
        if (!input || !input.files || !input.files[0]) return;

        var file = input.files[0];
        var reader = new FileReader();
        reader.onerror = function () { toast('文件读取失败，请重试'); };
        reader.onload = function () {
          if (!window.confirm('导入将覆盖当前所有数据，确定继续吗？\n文件：' + file.name)) return;
          var ri = Mg.importData(reader.result);
          toast(ri.message);
          if (ri.ok) setTimeout(function () { window.location.href = 'login.html'; }, 1200);
          input.value = '';
        };
        reader.readAsText(file);
      });
    }

    // 弹窗按钮
    var modalSubmit = document.getElementById('mgModalSubmit');
    if (modalSubmit) modalSubmit.addEventListener('click', submitMgModal);

    var modalCancel = document.getElementById('mgModalCancel');
    if (modalCancel) modalCancel.addEventListener('click', closeMgModal);

    var modalClose = document.getElementById('mgModalClose');
    if (modalClose) modalClose.addEventListener('click', closeMgModal);

    // 点击遮罩关闭弹窗
    var modal = document.getElementById('mgModal');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeMgModal();
      });
    }

    // 弹窗内 Ctrl/Cmd + Enter 快捷保存
    if (modal) {
      modal.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          submitMgModal();
        }
      });
    }
  }

  /* ------------------- 8.10.2 头像上传（所有页面共用） ------------------- */
  // 说明：头像编辑弹窗改为运行时注入，各 HTML 页面无需添加额外结构；
  //      入口：用户博客专区提示卡的「更换头像」按钮、以及自己主页上的「更换头像」按钮。

  /** 头像编辑状态：pending 为已压缩、待保存的 dataURL */
  var avatarState = { pending: '', hasNew: false };

  /** 当前页面的重渲染回调（头像变化后刷新界面用，由 init() 按页面注入） */
  var pageRefresh = null;

  /** 创建头像弹窗结构（只创建一次） */
  function ensureAvatarModal() {
    if (document.getElementById('avatarModal')) return;

    var html = '' +
      '<div class="modal" id="avatarModal">' +
      '<div class="modal__box">' +
      '<div class="modal__head">' +
      '<h3 class="modal__title">更换头像</h3>' +
      '<button type="button" class="modal__close" data-action="avatar-close" aria-label="关闭">✕</button>' +
      '</div>' +
      '<div class="modal__body">' +
      '<div class="form-msg" id="avatarMsg"></div>' +
      '<div class="avatar-editor">' +
      '<div class="avatar-editor__preview" id="avatarPreview"></div>' +
      '<div class="avatar-editor__side">' +
      '<p class="text-sub">选择一个图片文件作为头像，会自动居中裁剪为正方形并压缩（' +
      LIMITS.avatarSize + '×' + LIMITS.avatarSize + '），原图不超过 ' + LIMITS.avatarMaxMB + 'MB。</p>' +
      '<input class="input" type="file" id="avatarFile" accept="image/*" />' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="modal__foot">' +
      '<button type="button" class="btn btn--danger" id="avatarRemoveBtn" data-action="avatar-remove" ' +
      'style="margin-right:auto">移除头像</button>' +
      '<button type="button" class="btn btn--ghost" data-action="avatar-close">取消</button>' +
      '<button type="button" class="btn btn--primary" id="avatarSaveBtn" data-action="avatar-save">保存头像</button>' +
      '</div>' +
      '</div>' +
      '</div>';

    document.body.appendChild(htmlToElement(html));
  }

  /** 渲染弹窗内的头像预览（dataUrl 为空时显示首字符占位） */
  function renderAvatarPreview(dataUrl, username) {
    var el = document.getElementById('avatarPreview');
    if (!el) return;
    if (dataUrl) {
      el.innerHTML = '<img class="avatar" src="' + escapeHtml(dataUrl) + '" alt="头像预览" />';
    } else {
      el.innerHTML = '<span class="avatar avatar--placeholder">' +
        escapeHtml(avatarInitial(username)) + '</span>';
    }
  }

  /** 打开头像编辑弹窗 */
  function openAvatarEditor() {
    var user = Auth.current();
    if (!user) {
      toast('请先登录后再设置头像');
      setTimeout(function () { window.location.href = 'login.html'; }, 800);
      return;
    }

    ensureAvatarModal();
    avatarState.pending = '';
    avatarState.hasNew = false;

    var fileInput = document.getElementById('avatarFile');
    if (fileInput) fileInput.value = '';
    var removeBtn = document.getElementById('avatarRemoveBtn');
    if (removeBtn) removeBtn.disabled = !user.avatar;

    renderAvatarPreview(user.avatar || '', user.username);
    showFormMsg(document.getElementById('avatarMsg'), '', '');

    var modal = document.getElementById('avatarModal');
    if (modal) modal.classList.add('is-show');
  }

  /** 关闭头像编辑弹窗 */
  function closeAvatarEditor() {
    var modal = document.getElementById('avatarModal');
    if (modal) modal.classList.remove('is-show');
    avatarState.pending = '';
    avatarState.hasNew = false;
  }

  /** 保存 / 移除头像后的统一刷新：导航 + 当前页面列表 */
  function afterAvatarChange() {
    renderNav();
    if (typeof pageRefresh === 'function') pageRefresh();
  }

  /** 绑定头像相关交互（document 事件委托，兼容导航重新渲染） */
  function initAvatarEditor() {
    ensureAvatarModal();

    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-action="edit-avatar"]')) {
        e.preventDefault();
        openAvatarEditor();
        return;
      }

      if (e.target.closest('[data-action="avatar-close"]')) {
        closeAvatarEditor();
        return;
      }

      if (e.target.closest('[data-action="avatar-save"]')) {
        var msg = document.getElementById('avatarMsg');
        if (!avatarState.hasNew) {
          showFormMsg(msg, '请先选择一张图片（或点击「移除头像」）', 'error');
          return;
        }
        var saved = Auth.updateAvatar(avatarState.pending);
        toast(saved.message);
        if (!saved.ok) { showFormMsg(msg, saved.message, 'error'); return; }
        closeAvatarEditor();
        afterAvatarChange();
        return;
      }

      if (e.target.closest('[data-action="avatar-remove"]')) {
        if (!window.confirm('确定移除当前头像吗？移除后将显示用户名首字符。')) return;
        var removed = Auth.updateAvatar('');
        toast(removed.message);
        if (!removed.ok) return;
        closeAvatarEditor();
        afterAvatarChange();
        return;
      }

      // 点击遮罩空白处关闭
      var modal = document.getElementById('avatarModal');
      if (modal && e.target === modal) closeAvatarEditor();
    });

    // 选择图片 → 压缩 → 预览
    document.addEventListener('change', function (e) {
      var input = e.target.closest('#avatarFile');
      if (!input) return;

      var file = input.files && input.files[0];
      if (!file) return;
      var msg = document.getElementById('avatarMsg');

      compressAvatar(file).then(function (dataUrl) {
        avatarState.pending = dataUrl;
        avatarState.hasNew = true;
        renderAvatarPreview(dataUrl, '');
        showFormMsg(msg, '图片已就绪，点击「保存头像」即可生效', 'success');
      }).catch(function (err) {
        avatarState.pending = '';
        avatarState.hasNew = false;
        input.value = '';
        showFormMsg(msg, err.message, 'error');
      });
    });

    // Esc 关闭弹窗
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var modal = document.getElementById('avatarModal');
      if (modal && modal.classList.contains('is-show')) closeAvatarEditor();
    });
  }

  /* ---------------------- 8.11 站点提示横幅（全局） ---------------------- */
  /** 在所有页面顶部导航下方插入一条醒目的站点提示 */
  var SITE_NOTICE_TEXT = '梗指北早已完结，我们的故事仍在继续';

  function ensureSiteNotice() {
    if (document.getElementById('siteNotice')) return;

    var html = '' +
      '<div class="site-notice" id="siteNotice" role="note">' +
      '<span class="site-notice__icon" aria-hidden="true">✨</span>' +
      '<span class="site-notice__text">' + escapeHtml(SITE_NOTICE_TEXT) + '</span>' +
      '</div>';
    var node = htmlToElement(html);

    var header = document.querySelector('.site-header');
    if (header && header.parentNode) {
      header.parentNode.insertBefore(node, header.nextSibling);
    } else {
      document.body.insertBefore(node, document.body.firstChild);
    }
  }

  /* ---------------------- 8.11 意见反馈窗口（全局） ---------------------- */
  /** 创建「右下角悬浮按钮 + 反馈弹窗」结构（只创建一次） */
  function ensureFeedbackWidget() {
    if (document.getElementById('feedbackWidget')) return;

    var html = '' +
      '<div class="feedback-widget" id="feedbackWidget">' +
      '<button type="button" class="feedback-fab" data-action="feedback-open" ' +
      'title="意见反馈" aria-label="打开意见反馈窗口">' +
      '<span class="feedback-fab__icon" aria-hidden="true">💬</span>' +
      '<span class="feedback-fab__label">意见反馈</span>' +
      '</button>' +

      '<div class="modal" id="feedbackModal">' +
      '<div class="modal__box">' +
      '<div class="modal__head">' +
      '<h3 class="modal__title">💬 意见反馈</h3>' +
      '<button type="button" class="modal__close" data-action="feedback-close" aria-label="关闭">✕</button>' +
      '</div>' +
      '<div class="modal__body">' +
      '<div class="form-msg" id="feedbackMsg"></div>' +
      '<p class="text-sub" style="margin-top:0">欢迎提出你对「梗指北」的建议或意见，我们会认真查看每一条反馈。</p>' +
      '<div class="form-item">' +
      '<label class="form-label" for="feedbackType">反馈类型</label>' +
      '<select class="input" id="feedbackType">' +
      '<option value="suggestion">功能建议</option>' +
      '<option value="bug">问题反馈</option>' +
      '<option value="content">内容纠错</option>' +
      '<option value="other">其他</option>' +
      '</select>' +
      '</div>' +
      '<div class="form-item">' +
      '<label class="form-label" for="feedbackContent">反馈内容<span class="required">*</span></label>' +
      '<textarea class="textarea" id="feedbackContent" maxlength="' + LIMITS.feedbackMax + '" ' +
      'placeholder="请描述你的建议或遇到的问题…"></textarea>' +
      '<p class="form-hint"><span id="feedbackCounter">0</span> / ' + LIMITS.feedbackMax + '</p>' +
      '</div>' +
      '<div class="form-item">' +
      '<label class="form-label" for="feedbackContact">联系方式（选填）</label>' +
      '<input class="input" id="feedbackContact" type="text" maxlength="' + LIMITS.feedbackContactMax + '" ' +
      'placeholder="邮箱 / QQ / 微信，方便我们回复你" />' +
      '</div>' +
      '</div>' +
      '<div class="modal__foot">' +
      '<button type="button" class="btn btn--ghost" data-action="feedback-close">取消</button>' +
      '<button type="button" class="btn btn--primary" data-action="feedback-submit">提交反馈</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';

    document.body.appendChild(htmlToElement(html));
  }

  /** 打开反馈弹窗：重置表单与提示 */
  function openFeedbackModal() {
    ensureFeedbackWidget();
    var msg = document.getElementById('feedbackMsg');
    showFormMsg(msg, '', '');
    document.getElementById('feedbackType').value = 'suggestion';
    document.getElementById('feedbackContent').value = '';
    document.getElementById('feedbackContact').value = '';
    document.getElementById('feedbackCounter').textContent = '0';
    document.getElementById('feedbackModal').classList.add('is-show');
    var input = document.getElementById('feedbackContent');
    if (input) input.focus();
  }

  /** 关闭反馈弹窗 */
  function closeFeedbackModal() {
    var modal = document.getElementById('feedbackModal');
    if (modal) modal.classList.remove('is-show');
  }

  /** 提交反馈 */
  function submitFeedback() {
    var msg = document.getElementById('feedbackMsg');
    var result = Feedback.add(
      document.getElementById('feedbackType').value,
      document.getElementById('feedbackContent').value,
      document.getElementById('feedbackContact').value
    );

    if (!result.ok) { showFormMsg(msg, result.message, 'error'); return; }

    showFormMsg(msg, result.message, 'success');
    toast('感谢你的反馈，我们会认真查看！');
    setTimeout(closeFeedbackModal, 1000);
  }

  /** 绑定反馈相关交互（document 事件委托，兼容导航重新渲染） */
  function initFeedbackWidget() {
    ensureFeedbackWidget();

    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-action="feedback-open"]')) {
        e.preventDefault();
        openFeedbackModal();
        return;
      }
      if (e.target.closest('[data-action="feedback-close"]')) {
        closeFeedbackModal();
        return;
      }
      if (e.target.closest('[data-action="feedback-submit"]')) {
        submitFeedback();
        return;
      }

      // 点击遮罩空白处关闭
      var modal = document.getElementById('feedbackModal');
      if (modal && e.target === modal) closeFeedbackModal();
    });

    // 字数统计
    document.addEventListener('input', function (e) {
      if (e.target.id !== 'feedbackContent') return;
      var counter = document.getElementById('feedbackCounter');
      if (counter) counter.textContent = String(e.target.value.length);
    });

    // Esc 关闭弹窗
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var modal = document.getElementById('feedbackModal');
      if (modal && modal.classList.contains('is-show')) closeFeedbackModal();
    });
  }

  /* ---------------------------- 8.12 统一初始化 ---------------------------- */
  function init() {
    // 1) 保证管理员账号与 yg 的图片博客存在
    Auth.init();
    syncYgPosts();

    // 2) 公共导航（所有页面都有）
    renderNav();
    initNavActions();       // 退出登录（document 委托，只绑一次）
    initLightbox();
    initAvatarEditor();     // 头像上传弹窗（所有页面共用）
    ensureSiteNotice();     // 站点提示横幅（所有页面共用）
    initFeedbackWidget();   // 意见反馈窗口（所有页面共用）
    ensureTextEditorModal();// 管理员博客文字编辑弹窗（所有页面共用）

    // 3) 按页面分发初始化逻辑（由 body 的 data-page 决定）
    var page = document.body.getAttribute('data-page') || 'home';
    switch (page) {
      case 'home':
        initHomeFilters();
        initHomeSections();
        initSidebar();          // 左侧目录栏（管理员博客 / 用户博客）
        // 两个分区各自绑定评论/删除/展开等交互
        bindPostInteractions(document.getElementById(HOME_SECTIONS.admin.listId), renderHome);
        bindPostInteractions(document.getElementById(HOME_SECTIONS.user.listId), renderHome);
        updateZoneBanner();     // 首页专区入口横幅的提示文案
        pageRefresh = renderHome;
        renderHome();
        break;
      case 'user':
        // 用户博客专区：提示卡 + 用户博客列表
        initUserZonePage();
        bindPostInteractions(document.getElementById('userPostList'), renderUserZone);
        pageRefresh = renderUserZone;
        renderUserZone();
        break;
      case 'post':
        // 单篇博客详情页：先渲染内容，再绑定评论/删除/图片放大等交互
        bindPostInteractions(document.getElementById('postDetail'), renderPostPage);
        pageRefresh = renderPostPage;
        renderPostPage();
        break;
      case 'profile':
        // 用户主页：展示用户信息（含真实姓名）与 TA 发布的博客
        initProfilePage();
        break;
      case 'login':
        initLoginPage();
        break;
      case 'register':
        initRegisterPage();
        break;
      case 'publish':
        initPublishPage();
        break;
      case 'mg':
        // 可视化管理员后台（仅管理员 yg 可用）
        initMgPage();
        pageRefresh = typeof refreshMg === 'function' ? refreshMg : null;
        break;
      default:
        break;
    }

    // 4) 应用「管理员博客文字覆盖」（本地编辑 + 仓库 data/admin-posts.json）后刷新当前页
    loadAdminPostText().then(function () {
      if (typeof pageRefresh === 'function') pageRefresh();
    });
  }

  // DOM 就绪后启动（script 标签带 defer，此处通常已经就绪）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ======================================================================
   * 十、对外暴露（方便在浏览器控制台里调试 / 二次开发）
   * 例如：BlogApp.Posts.list({ filter: 'yg' }).length
   * ====================================================================== */
  window.BlogApp = {
    Auth: Auth,
    Posts: Posts,
    Comments: Comments,
    Feedback: Feedback,
    Mg: Mg,
    Store: Store,
    YG_IMAGES: YG_IMAGES,
    syncYgPosts: syncYgPosts,
    utils: { formatTime: formatTime, escapeHtml: escapeHtml, uid: uid, simpleHash: simpleHash, avatarHtml: avatarHtml }
  };
})();
