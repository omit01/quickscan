FROM composer:2 AS composer

FROM php:8.4-apache-bookworm AS base
COPY --from=composer /usr/bin/composer /usr/bin/composer

RUN apt-get update && apt-get install -y --no-install-recommends \
   ca-certificates curl gnupg libcurl4-openssl-dev libonig-dev libsqlite3-dev libxml2-dev unzip \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
       | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
       > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
   && apt-get install -y --no-install-recommends nodejs supervisor \
   && docker-php-ext-install bcmath curl mbstring pcntl pdo_mysql pdo_sqlite xml \
    && a2enmod rewrite headers \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build
WORKDIR /var/www/quickscan
COPY . .
RUN npm ci \
    && npm run build \
    && npm prune --omit=dev \
    && COMPOSER_ALLOW_SUPERUSER=1 composer install --working-dir=apps/web \
       --no-dev --no-interaction --prefer-dist --optimize-autoloader

FROM base

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /var/www/quickscan/apps/web
COPY --from=build /var/www/quickscan /var/www/quickscan
COPY docker/apache-site.conf /etc/apache2/sites-available/000-default.conf
COPY docker/supervisord.conf /etc/supervisor/conf.d/quickscan.conf
COPY docker/entrypoint.sh /usr/local/bin/quickscan-entrypoint
RUN chmod +x /usr/local/bin/quickscan-entrypoint \
    && npx playwright install --with-deps chromium \
    && mkdir -p storage/app/private/scans storage/framework/cache \
       storage/framework/sessions storage/framework/views bootstrap/cache \
    && chown -R www-data:www-data storage bootstrap/cache

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
   CMD curl --fail --silent http://127.0.0.1/up >/dev/null && supervisorctl status queue | grep -q RUNNING
ENTRYPOINT ["/usr/local/bin/quickscan-entrypoint"]
CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]