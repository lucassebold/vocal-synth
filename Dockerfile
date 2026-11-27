# Chimera Songs, for Railway (or any host that runs a Dockerfile).
#
#   1. engine : the voice engine, built twice: as wasm for the browser, and as the command line
#               that the server uses to sing and mix the bands
#   2. web    : the web app (Vite), with the wasm from step 1
#   3. runtime: Node serving the app and the gallery API, with ffmpeg for the mixes
#
# Needs a volume mounted at /data (the gallery and the rendered songs live there).

# ---- 1. engine
FROM rust:1-bookworm AS engine
WORKDIR /app
RUN rustup target add wasm32-unknown-unknown
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo build --release -p chimera-wasm --target wasm32-unknown-unknown \
 && cargo build --release -p chimera-cli

# ---- 2. web
FROM oven/bun:1 AS web
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
COPY --from=engine /app/target/wasm32-unknown-unknown/release/chimera_wasm.wasm src/wasm/chimera.wasm
# vite directly: `bun run build` would also build the wasm again
RUN bun --bun node_modules/vite/bin/vite.js build

# ---- 3. runtime
FROM node:20-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=engine /app/target/release/chimera /app/bin/chimera
# the command line looks for its dictionary at the path it was built in: /app/crates/chimera-cli/../../public/data
RUN mkdir -p /app/crates/chimera-cli /app/public/data /data
COPY public/data/cmudict.txt.gz /app/public/data/cmudict.txt.gz
COPY --from=web /app/dist /app/dist
COPY server /app/server
COPY seed /app/seed

ENV NODE_ENV=production \
    DATA_DIR=/data \
    CHIMERA_BIN=/app/bin/chimera \
    FFMPEG=ffmpeg
# Railway sets PORT; the server reads it
EXPOSE 5320
CMD ["node", "server/server.cjs"]
