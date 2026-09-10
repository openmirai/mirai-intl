#!/bin/sh
set -eu
native_target="$1"
native_revision="$2"
native_output="$3"
native_node="$4"
case "$native_target" in
  *-gnu)
    # manylinux_2_28 provides the glibc 2.28 sysroot and compiler toolchain.
    native_arch=x64
    case "$native_target" in *-arm64-*) native_arch=arm64 ;; esac
    native_archive="node-${native_node}-linux-${native_arch}.tar.xz"
    curl --fail --silent --show-error --location "https://nodejs.org/dist/${native_node}/${native_archive}" -o "/tmp/${native_archive}"
    curl --fail --silent --show-error --location "https://nodejs.org/dist/${native_node}/SHASUMS256.txt" -o /tmp/node-shasums
    (cd /tmp && grep " ${native_archive}\$" node-shasums | sha256sum --check --strict -)
    tar -xJf "/tmp/${native_archive}" -C /opt
    PATH="/opt/node-${native_node}-linux-${native_arch}/bin:$PATH"
    export PATH
    ;;
  *-musl)
    apk add --no-cache build-base curl git bash python3 binutils
    ;;
  *) exit 64 ;;
esac
curl --proto '=https' --tlsv1.2 --fail --silent --show-error https://sh.rustup.rs -o /tmp/native-rustup.sh
sh /tmp/native-rustup.sh -y --profile minimal --default-toolchain 1.98.0
PATH="$HOME/.cargo/bin:$PATH"
export PATH
# Container checkout is bind-mounted from the trusted hosted producer.
git config --global --add safe.directory /work
node native/scripts/build-target.mjs "$native_target" "$native_revision" "$native_output" container
