# Dev environment: Node 24 + Rust + wasm-pack.
# Never install Rust on the host — open this folder in a Dev Container instead.
FROM node:24-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    git \
    pkg-config \
  && rm -rf /var/lib/apt/lists/*

# Rust toolchain (wasm target) — only inside this image
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable \
  && rustup target add wasm32-unknown-unknown \
  && curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh \
  && chmod -R a+rX /usr/local/cargo /usr/local/rustup \
  && rustc --version && cargo --version && wasm-pack --version

# wasm-pack / cargo may write registry caches; allow non-root dev user
RUN mkdir -p /usr/local/cargo/registry /usr/local/cargo/git \
  && chmod -R a+rwX /usr/local/cargo

WORKDIR /workspace
