-- 预览 / 正式 / 验收三套数据库物理隔离，杜绝预览数据写入正式项目库。
-- 默认连接库 POSTGRES_DB 已由镜像创建，这里补充另外两套。
CREATE DATABASE workbench_prod;
CREATE DATABASE workbench_test;
