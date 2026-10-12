FROM php:8.3-apache

ARG YUDAO_RELEASE=development
ARG YUDAO_SOURCE_REVISION=unknown
LABEL org.opencontainers.image.title="Piwigo 渔岛设计资料库" \
      org.opencontainers.image.version=$YUDAO_RELEASE \
      org.opencontainers.image.revision=$YUDAO_SOURCE_REVISION

ARG PHP_EXT_BUILD_JOBS=2
ARG PHP_EXT_CFLAGS=

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libfreetype6-dev \
        libjpeg62-turbo-dev \
        libonig-dev \
        libpng-dev \
        libwebp-dev \
        libzip-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg --with-webp \
    && CFLAGS="${CFLAGS} ${PHP_EXT_CFLAGS}" docker-php-ext-install -j"${PHP_EXT_BUILD_JOBS}" mysqli gd mbstring exif zip \
    && a2enmod rewrite \
    && rm -rf /var/lib/apt/lists/*

COPY deploy/yudao/php.ini /usr/local/etc/php/conf.d/yudao-piwigo.ini
COPY deploy/yudao/root-redirect.conf /etc/apache2/conf-available/yudao-piwigo-root-redirect.conf
COPY deploy/yudao/entrypoint.sh /usr/local/bin/yudao-piwigo-entrypoint
RUN chmod 0755 /usr/local/bin/yudao-piwigo-entrypoint \
    && mkdir -p /opt/piwigo /var/lib/yudao-design \
    && a2enconf yudao-piwigo-root-redirect

COPY . /opt/piwigo/
RUN printf '{"release":"%s","revision":"%s"}\n' "$YUDAO_RELEASE" "$YUDAO_SOURCE_REVISION" > /opt/yudao-release.json

ENV YUDAO_STORAGE_ROOT=/var/lib/yudao-design
VOLUME ["/var/www/html", "/var/lib/yudao-design"]

ENTRYPOINT ["/usr/local/bin/yudao-piwigo-entrypoint"]
CMD ["apache2-foreground"]
