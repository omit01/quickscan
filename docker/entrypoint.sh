#!/bin/sh
set -eu

cd /var/www/quickscan/apps/web
if [ "${1:-}" != /usr/bin/supervisord ]; then
    exec "$@"
fi

if [ "${APP_ENV:-local}" = production ]; then
    if [ -z "${APP_KEY:-}" ] || [ "${APP_DEBUG:-false}" != false ] || [ "${DEV_SOL_BYPASS:-false}" != false ]; then
        echo 'Production requires APP_KEY, APP_DEBUG=false and DEV_SOL_BYPASS=false.' >&2
        exit 1
    fi
    case "${APP_URL:-}" in
        https://*) ;;
        *) echo 'Production requires an HTTPS APP_URL.' >&2; exit 1 ;;
    esac
    if [ "${SESSION_SECURE_COOKIE:-false}" != true ]; then
        echo 'Production requires SESSION_SECURE_COOKIE=true.' >&2
        exit 1
    fi
    if [ -z "${OIDC_ISSUER:-}" ] || [ -z "${OIDC_CLIENT_ID:-}" ] || [ -z "${OIDC_CLIENT_SECRET:-}" ] || [ -z "${OIDC_MEMBERSHIP_CLAIM:-}" ] || [ -z "${OIDC_MEMBERSHIP_VALUES:-}" ]; then
        echo 'Production requires complete SOL issuer, client and membership configuration.' >&2
        exit 1
    fi
fi

case "${DB_QUEUE_RETRY_AFTER:-1200}" in
    ''|*[!0-9]*) echo 'DB_QUEUE_RETRY_AFTER must be an integer greater than 900.' >&2; exit 1 ;;
esac
if [ "${DB_QUEUE_RETRY_AFTER:-1200}" -le 900 ]; then
    echo 'DB_QUEUE_RETRY_AFTER must exceed the 900-second worker timeout.' >&2
    exit 1
fi

mkdir -p storage/app/private/scans storage/framework/cache storage/framework/sessions storage/framework/views bootstrap/cache
if [ "${DB_CONNECTION:-sqlite}" = sqlite ]; then
    database_path="${DB_DATABASE:-database/database.sqlite}"
    case "$database_path" in
        /*) ;;
        *) database_path="$PWD/$database_path" ;;
    esac
    mkdir -p "$(dirname "$database_path")"
    touch "$database_path"
fi
chown -R www-data:www-data storage bootstrap/cache
php artisan migrate --force --no-interaction
php artisan quickscan:import-reports || echo 'Some legacy reports could not be imported; their files were preserved.' >&2

exec "$@"