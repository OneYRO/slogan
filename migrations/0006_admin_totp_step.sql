-- 记录管理员最近一次成功使用过的 TOTP 时间步，防止同一动态码在有效窗口内被重复使用
ALTER TABLE admins ADD COLUMN totp_last_step INTEGER NOT NULL DEFAULT 0;
