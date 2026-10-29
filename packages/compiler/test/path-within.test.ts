import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  ancestorDirectories,
  confinedRelativePath,
  isPathStrictlyWithin,
  isPathWithin,
  isSamePath,
  prospectiveRealpath,
  prospectiveRealpathSync,
  relationWithin,
  relativePathWithin,
} from "../src/path-within";

describe("path containment", () => {
  it("tells equal, inside and outside apart by segments", () => {
    const relation = (root: string, candidate: string) =>
      relationWithin(root, candidate, posix);
    expect(relation("/a/b", "/a/b")).toBe("equal");
    expect(relation("/a/b", "/a/b/")).toBe("equal");
    expect(relation("/a/b", "/a/b/c/d.json")).toBe("inside");
    // A sibling that only shares the string prefix is outside.
    expect(relation("/a/b", "/a/bc")).toBe("outside");
    expect(relation("/a/b", "/a/bc/d")).toBe("outside");
    // The parent and anything reached through '..' are outside.
    expect(relation("/a/b", "/a")).toBe("outside");
    expect(relation("/a/b", "/a/b/../c")).toBe("outside");
    expect(relation("/a/b", "/")).toBe("outside");
    // A name that only starts with '..' is an ordinary child.
    expect(relation("/a/b", "/a/b/..foo")).toBe("inside");
    expect(relation("/a/b", "/a/b/..")).toBe("outside");
    expect(relation("/a/b", "/a/b/...")).toBe("inside");
  });

  it("treats another Windows drive as outside, and drive letters case-insensitively", () => {
    const relation = (root: string, candidate: string) =>
      relationWithin(root, candidate, win32);
    expect(relation("C:\\a\\b", "D:\\a\\b\\c")).toBe("outside");
    expect(relation("C:\\a\\b", "C:\\a\\b\\c")).toBe("inside");
    expect(relation("C:\\a\\b", "c:\\A\\B\\c")).toBe("inside");
    expect(relation("C:\\a\\b", "C:\\a\\b")).toBe("equal");
    expect(relation("C:\\a\\b", "C:\\a\\bc")).toBe("outside");
    expect(relation("C:\\a\\b", "C:\\a\\b\\..foo")).toBe("inside");
    expect(relation("C:\\a\\b", "C:\\a")).toBe("outside");
    expect(isPathWithin("C:\\a", "D:\\a", win32)).toBe(false);
    expect(relativePathWithin("C:\\a", "C:\\a\\b\\c.ts", win32)).toBe("b/c.ts");
    expect(relativePathWithin("C:\\a", "D:\\a\\b", win32)).toBeUndefined();
  });

  it("derives the inclusive, strict and same-path checks from one relation", () => {
    expect(isPathWithin("/a/b", "/a/b", posix)).toBe(true);
    expect(isPathWithin("/a/b", "/a/b/c", posix)).toBe(true);
    expect(isPathWithin("/a/b", "/a", posix)).toBe(false);
    expect(isPathStrictlyWithin("/a/b", "/a/b", posix)).toBe(false);
    expect(isPathStrictlyWithin("/a/b", "/a/b/c", posix)).toBe(true);
    expect(isPathStrictlyWithin("/a/b", "/a/bc", posix)).toBe(false);
    expect(isSamePath("/a/b/", "/a/b", posix)).toBe(true);
    expect(isSamePath("/a/b", "/a/b/c", posix)).toBe(false);
  });

  it("gives the portable path below the root, or throws the caller's message", () => {
    expect(relativePathWithin("/a", "/a/b/c.ts", posix)).toBe("b/c.ts");
    expect(relativePathWithin("/a", "/a/..foo/c.ts", posix)).toBe("..foo/c.ts");
    // The root itself and its parent have no path below the root.
    expect(relativePathWithin("/a", "/a", posix)).toBeUndefined();
    expect(relativePathWithin("/a/b", "/a", posix)).toBeUndefined();
    expect(confinedRelativePath("/a", "/a/b", "escapes", posix)).toBe("b");
    expect(() => confinedRelativePath("/a/b", "/a", "escapes", posix)).toThrow(
      /^escapes$/u
    );
    expect(() =>
      confinedRelativePath("/a/b", "/a/bc/d", "escapes", posix)
    ).toThrow(/^escapes$/u);
    expect(() => confinedRelativePath("/a", "/a", "escapes", posix)).toThrow(
      /^escapes$/u
    );
  });

  it("walks from the start folder up to the filesystem root", () => {
    expect([...ancestorDirectories("/a/b/c", posix)]).toEqual([
      "/a/b/c",
      "/a/b",
      "/a",
      "/",
    ]);
    expect([...ancestorDirectories("/", posix)]).toEqual(["/"]);
    expect([...ancestorDirectories("C:\\a\\b", win32)]).toEqual([
      "C:\\a\\b",
      "C:\\a",
      "C:\\",
    ]);
  });
});

describe("prospective realpath", () => {
  // root/real/sub exists; root/link -> root/real; root/out -> outside;
  // root/dangling -> a missing target.
  const base = realpathSync(mkdtempSync(join(tmpdir(), "prospective-")));
  const root = join(base, "root");
  const outside = join(base, "outside");
  mkdirSync(join(root, "real", "sub"), { recursive: true });
  mkdirSync(outside);
  symlinkSync(join(root, "real"), join(root, "link"));
  symlinkSync(outside, join(root, "out"));
  symlinkSync(join(base, "missing"), join(root, "dangling"));
  afterAll(() => rmSync(base, { force: true, recursive: true }));

  const both = async (path: string): Promise<string> => {
    const sync = prospectiveRealpathSync(path, "unresolved");
    expect(await prospectiveRealpath(path, "unresolved")).toBe(sync);
    return sync;
  };

  it("returns the realpath of an existing folder", async () => {
    expect(await both(join(root, "real", "sub"))).toBe(
      join(root, "real", "sub")
    );
  });

  it("appends missing tail segments to the nearest existing ancestor", async () => {
    expect(await both(join(root, "real", "a", "b"))).toBe(
      join(root, "real", "a", "b")
    );
  });

  it("resolves a symlinked ancestor to its target", async () => {
    expect(await both(join(root, "link", "sub", "new"))).toBe(
      join(root, "real", "sub", "new")
    );
  });

  it("lets the caller refuse an escape through a symlink outside the root", async () => {
    const canonical = await both(join(root, "out", "generated"));
    expect(canonical).toBe(join(outside, "generated"));
    expect(isPathWithin(root, canonical)).toBe(false);
  });

  it("resolves '..' segments before walking", async () => {
    expect(await both(join(root, "real", "x", "..", "..", "link", "y"))).toBe(
      join(root, "real", "y")
    );
    expect(
      isPathWithin(root, await both(join(root, "real", "..", "..", "z")))
    ).toBe(false);
  });

  it("treats a bundler virtual id (a NUL byte) as missing", async () => {
    expect(await both(join(root, "link", "\0vite", "preload-helper.js"))).toBe(
      join(root, "real", "\0vite", "preload-helper.js")
    );
  });

  it("fails closed with the caller's message on a dangling symlink", async () => {
    const path = join(root, "dangling", "x");
    expect(() => prospectiveRealpathSync(path, "unresolved")).toThrow(
      /^unresolved$/u
    );
    await expect(prospectiveRealpath(path, "unresolved")).rejects.toThrow(
      /^unresolved$/u
    );
  });
});
