# syntax=docker/dockerfile:1.7

# Build stage: install only the web app's workspace dependency graph and
# compile the SvelteKit app into apps/web/build.
FROM node:22-bookworm-slim AS build

ENV CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /app

RUN corepack enable

# Copy lockfiles and package manifests first so dependency installation is
# cached until a dependency definition changes.
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod=false --filter @pdf-complianttools/web...

# Copy only files needed to build the selected web workspace.
COPY tsconfig.base.json ./
COPY scripts/build-web.mjs scripts/build-web.mjs
COPY apps/web/src apps/web/src
COPY apps/web/static apps/web/static
COPY apps/web/svelte.config.js apps/web/svelte.config.js
COPY apps/web/tsconfig.json apps/web/tsconfig.json
COPY apps/web/vite.config.ts apps/web/vite.config.ts
COPY packages/engine/src packages/engine/src
COPY packages/engine/tsconfig.json packages/engine/tsconfig.json
COPY packages/ui/src packages/ui/src
COPY packages/ui/tsconfig.json packages/ui/tsconfig.json

RUN pnpm --filter @pdf-complianttools/web... build

# Runtime stage: only nginx and the generated static site are shipped.
FROM nginx:1.27-alpine AS runtime

ENV NGINX_ENTRYPOINT_QUIET_LOGS=1

RUN rm /etc/nginx/conf.d/default.conf

COPY --from=build --chown=nginx:nginx /app/apps/web/build/ /usr/share/nginx/html/

# Keep the runtime configuration in this Dockerfile so the image remains a
# single-file build definition. The fallback supports both prerendered
# `/route.html` files and extensionless `/route` links.
COPY <<'NGINX' /etc/nginx/conf.d/default.conf
server {
    listen 8080;
    listen [::]:8080;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;
    server_tokens off;

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location = /healthz {
        access_log off;
        default_type text/plain;
        return 200 "ok\n";
    }

    location ~* \.(?:css|gif|ico|jpe?g|js|map|png|svg|webp|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # pdfjs-dist emits its worker as an ES module. The stock Alpine Nginx
    # mime.types maps .js but not .mjs, so without this location the worker is
    # returned as application/octet-stream and browsers reject the dynamic
    # import with "Setting up fake worker failed".
    location ~* \.mjs$ {
        default_type application/javascript;
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # Keep every Vite immutable asset on the static-file path. This covers
    # lazy chunks, WASM runtimes, manifests, and future asset extensions on
    # every route; none of them should be rewritten to a prerendered HTML
    # page by the application fallback below.
    location ~* ^/_app/immutable/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    location / {
        try_files $uri $uri/ $uri.html /200.html;
    }
}
NGINX

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --spider http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
