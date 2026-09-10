export const matrix = Object.freeze([
  {
    target: "darwin-arm64",
    runner: "macos-14",
    triple: "aarch64-apple-darwin",
    arch: "arm64",
  },
  {
    target: "darwin-x64",
    runner: "macos-15-intel",
    triple: "x86_64-apple-darwin",
    arch: "x64",
  },
  {
    target: "linux-arm64-gnu",
    runner: "ubuntu-24.04-arm",
    triple: "aarch64-unknown-linux-gnu",
    arch: "arm64",
    image: "quay.io/pypa/manylinux_2_28_aarch64:latest",
  },
  {
    target: "linux-x64-gnu",
    runner: "ubuntu-24.04",
    triple: "x86_64-unknown-linux-gnu",
    arch: "x64",
    image: "quay.io/pypa/manylinux_2_28_x86_64:latest",
  },
  {
    target: "linux-arm64-musl",
    runner: "ubuntu-24.04-arm",
    triple: "aarch64-unknown-linux-musl",
    arch: "arm64",
    image: "node:NODE_VERSION-alpine",
  },
  {
    target: "linux-x64-musl",
    runner: "ubuntu-24.04",
    triple: "x86_64-unknown-linux-musl",
    arch: "x64",
    image: "node:NODE_VERSION-alpine",
  },
  {
    target: "win32-arm64",
    runner: "windows-11-arm",
    triple: "aarch64-pc-windows-msvc",
    arch: "arm64",
  },
  {
    target: "win32-x64",
    runner: "windows-2022",
    triple: "x86_64-pc-windows-msvc",
    arch: "x64",
  },
]);
