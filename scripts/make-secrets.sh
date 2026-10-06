#!/usr/bin/env sh
set -eu
printf 'JWT_SECRET=%s\n' "$(openssl rand -hex 32)"
printf 'CALLBACK_SECRET=%s\n' "$(openssl rand -hex 32)"
printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24)"
printf 'S3_ACCESS_KEY_ID=%s\n' "workbench-$(openssl rand -hex 12)"
printf 'S3_SECRET_ACCESS_KEY=%s\n' "$(openssl rand -hex 24)"
