#!/usr/bin/env bash
# Builds the deployable wasm.
#
# nearcore's VM only accepts wasm produced by rustc 1.86 or older; anything
# newer deploys but fails every call with
# `CompilationError(PrepareError(Deserialization))`. near-sdk is therefore
# pinned to =5.24.1, the newest release that compiles on 1.86.
set -euo pipefail

rustup toolchain install 1.86 --profile minimal -c rust-std >/dev/null 2>&1 || true
rustup target add wasm32-unknown-unknown --toolchain 1.86 >/dev/null 2>&1 || true

for crate in contract test-token; do
  ( cd "$crate" && cargo +1.86 near build non-reproducible-wasm )
done

ls -l target/near/*/*.wasm
