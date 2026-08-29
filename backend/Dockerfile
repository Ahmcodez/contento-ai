# Single image for both the API and the worker (docs/adr/003 — modular
# monolith, two deployable units sharing one codebase). Which process
# runs is decided by CMD/command, not by building two images.
FROM node:20-bookworm-slim

# FFmpeg must be available inside the worker environment (audio
# extraction, clip rendering, thumbnails, probing). Installed here so
# it's present in both backend and worker containers built from this
# image — harmless for the API container, which never calls it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
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
