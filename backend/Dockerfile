# Single image for both the API and the worker (docs/adr/003 — modular
# monolith, two deployable units sharing one codebase). Which process
# runs is decided by CMD/command, not by building two images.
FROM node:20-bookworm-slim

# FFmpeg must be available inside the worker environment (audio
# extraction, clip rendering, thumbnails, probing). Installed here so
# it's present in both backend and worker containers built from this
# image — harmless for the API container, which never calls it.
#
# yt-dlp powers "Paste Video URL" imports (YouTube etc.). The standalone
# release binary is used rather than pip so the image needs no Python.
# It is fetched at build time and `--version` is run so a broken download
# fails the build instead of failing the first user's import. YouTube
# changes often and old yt-dlp builds stop working, so rebuild the image
# regularly (or pin by replacing /latest/download/ with /download/<tag>/).
ARG TARGETARCH=amd64
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
    && case "$TARGETARCH" in arm64) YTDLP_ASSET=yt-dlp_linux_aarch64 ;; *) YTDLP_ASSET=yt-dlp_linux ;; esac \
    && curl -fsSL -o /usr/local/bin/yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDLP_ASSET}" \
    && chmod 0755 /usr/local/bin/yt-dlp \
    && yt-dlp --version \
    && apt-get purge -y --auto-remove curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Local-disk storage (StorageDriver default) lives here — mounted as a
# shared volume between the api and worker services in docker-compose.yml
# so a file the API writes is visible to the worker that processes it.
RUN mkdir -p storage/uploads storage/tmp

EXPOSE 4000

CMD ["node", "src/server.js"]
