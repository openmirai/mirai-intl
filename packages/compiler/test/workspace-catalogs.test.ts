import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  discoverWorkspaceCatalogs,
  installWorkspaceRoot,
  nearestWorkspaceRoot,
  walkWorkspaceRoots,
} from "../src/workspace-catalogs";

async function writeFiles(root: string, files: ReadonlyArray<string>) {
  for (const file of files) {
    await mkdir(join(root, file, ".."), { recursive: true });
    await writeFile(join(root, file), "{}\n", "utf8");
  }
}

const declaredRoot = `${JSON.stringify({ root: true })}\n`;

// One pnpm workspace holding fe's apps plus landing and dashboard, which
// keep their own intl workspaces (mirai-web after the join, V2D-2747).
async function joinedMonorepo(): Promise<string> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "mirai-intl-workspace-boundary-"))
  );
  await writeFiles(root, [
    "pnpm-workspace.yaml",
    "mirai-intl.workspace.json",
    "apps/staff/mirai-intl.config.json",
    "apps/staff/package.json",
    "packages/i18n/mirai-intl.config.json",
    "packages/i18n/package.json",
    "apps/landing/mirai-intl.config.json",
    "apps/landing/package.json",
    "apps/landing/src/app/package.json",
    "apps/dashboard/mirai-intl.config.json",
    "apps/dashboard/package.json",
  ]);
  return root;
}

describe("workspace catalog discovery", () => {
  it("finds configured and package-root convention catalogs, and nothing in a nested workspace or deeper in a package", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-workspace-catalogs-"))
    );
    try {
      await writeFiles(root, [
        "pnpm-workspace.yaml",
        "apps/staff/mirai-intl.config.json",
        "apps/staff/package.json",
        "packages/i18n/package.json",
        "packages/i18n/locales/en.json",
        // Another workspace inside this one: its own root checks it.
        "apps/landing/pnpm-workspace.yaml",
        "apps/landing/mirai-intl.config.json",
        "apps/landing/package.json",
        // Message files deep inside a package, with no package.json of their own.
        "services/email-consumer/package.json",
        "services/email-consumer/src/emails/locales/en.json",
      ]);
      await expect(discoverWorkspaceCatalogs(root)).resolves.toEqual([
        join(root, "apps/staff"),
        join(root, "packages/i18n"),
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("keeps today's discovery and roots when no folder declares itself a root", async () => {
    const root = await joinedMonorepo();
    try {
      await expect(discoverWorkspaceCatalogs(root)).resolves.toEqual([
        join(root, "apps/dashboard"),
        join(root, "apps/landing"),
        join(root, "apps/staff"),
        join(root, "packages/i18n"),
      ]);
      await expect(
        nearestWorkspaceRoot(join(root, "apps/landing"))
      ).resolves.toBe(root);
      await expect(
        installWorkspaceRoot(join(root, "apps/landing"))
      ).resolves.toBe(root);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("leaves folders that declare themselves intl workspace roots to their own checks", async () => {
    const root = await joinedMonorepo();
    try {
      for (const app of ["apps/landing", "apps/dashboard"]) {
        await writeFile(
          join(root, app, "mirai-intl.workspace.json"),
          declaredRoot
        );
      }
      await expect(discoverWorkspaceCatalogs(root)).resolves.toEqual([
        join(root, "apps/staff"),
        join(root, "packages/i18n"),
      ]);
      const landing = join(root, "apps/landing");
      await expect(nearestWorkspaceRoot(landing)).resolves.toBe(landing);
      await expect(
        nearestWorkspaceRoot(join(landing, "src/app"))
      ).resolves.toBe(landing);
      // One root install: the declared root is confined at the pnpm root.
      await expect(installWorkspaceRoot(landing)).resolves.toBe(root);
      await expect(
        installWorkspaceRoot(join(landing, "src/app"))
      ).resolves.toBe(root);
      // fe's packages still resolve the shared pnpm root.
      await expect(
        nearestWorkspaceRoot(join(root, "apps/staff"))
      ).resolves.toBe(root);
      await expect(
        installWorkspaceRoot(join(root, "apps/staff"))
      ).resolves.toBe(root);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a root field that is not true", async () => {
    const root = await joinedMonorepo();
    try {
      await writeFile(
        join(root, "apps/landing/mirai-intl.workspace.json"),
        `${JSON.stringify({ root: false })}\n`
      );
      await expect(discoverWorkspaceCatalogs(root)).rejects.toThrow(
        /root must be true when present/u
      );
      await expect(
        nearestWorkspaceRoot(join(root, "apps/landing"))
      ).rejects.toThrow(/root must be true when present/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

describe("install workspace root", () => {
  it("confines at a declared intl root when no pnpm workspace is above it", async () => {
    const outer = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-install-root-"))
    );
    try {
      const landing = join(outer, "apps/landing");
      await writeFiles(outer, ["apps/landing/package.json"]);
      await writeFile(join(landing, "mirai-intl.workspace.json"), declaredRoot);
      await mkdir(join(landing, "src"), { recursive: true });
      await expect(installWorkspaceRoot(join(landing, "src"))).resolves.toBe(
        landing
      );
      await expect(nearestWorkspaceRoot(join(landing, "src"))).resolves.toBe(
        landing
      );
    } finally {
      await rm(outer, { force: true, recursive: true });
    }
  });

  it("falls back to the start folder with neither a pnpm workspace nor a declared root", async () => {
    const outer = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-install-root-"))
    );
    try {
      const app = join(outer, "app");
      await writeFiles(outer, ["app/package.json"]);
      await expect(installWorkspaceRoot(app)).resolves.toBe(app);
    } finally {
      await rm(outer, { force: true, recursive: true });
    }
  });

  it("refuses a pnpm-workspace.yaml that is not a regular file", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-install-root-"))
    );
    try {
      await mkdir(join(root, "pnpm-workspace.yaml"));
      await writeFiles(root, ["app/package.json"]);
      await expect(installWorkspaceRoot(join(root, "app"))).rejects.toThrow(
        /pnpm-workspace\.yaml must be a regular file/u
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("finds the intl root and the install root in one walk", async () => {
    const root = await joinedMonorepo();
    try {
      const landing = join(root, "apps/landing");
      await writeFile(join(landing, "mirai-intl.workspace.json"), declaredRoot);
      await expect(
        walkWorkspaceRoots(join(landing, "src/app"))
      ).resolves.toEqual({
        install: root,
        intl: landing,
      });
      await expect(
        walkWorkspaceRoots(join(root, "apps/staff"))
      ).resolves.toEqual({ install: root, intl: root });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("has no intl root with neither a pnpm workspace nor a declared root", async () => {
    const outer = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-install-root-"))
    );
    try {
      const app = join(outer, "app");
      await writeFiles(outer, ["app/package.json"]);
      await expect(walkWorkspaceRoots(app)).resolves.toEqual({ install: app });
      await expect(nearestWorkspaceRoot(app)).rejects.toThrow(
        /--workspace requires a parent pnpm-workspace\.yaml/u
      );
    } finally {
      await rm(outer, { force: true, recursive: true });
    }
  });

  it("refuses a symlinked pnpm-workspace.yaml in every walk and in discovery", async () => {
    const outer = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-install-root-"))
    );
    try {
      await writeFiles(outer, [
        "real/pnpm-workspace.yaml",
        "repo/apps/staff/mirai-intl.config.json",
        "repo/apps/staff/package.json",
      ]);
      const repo = join(outer, "repo");
      const staff = join(repo, "apps/staff");
      await symlink(
        join(outer, "real/pnpm-workspace.yaml"),
        join(repo, "pnpm-workspace.yaml")
      );
      for (const walk of [
        walkWorkspaceRoots,
        installWorkspaceRoot,
        nearestWorkspaceRoot,
      ]) {
        await expect(walk(staff)).rejects.toThrow(
          /pnpm-workspace\.yaml must be a regular file/u
        );
      }
      // A nested workspace with a symlinked manifest is refused, not
      // silently discovered as part of the outer workspace.
      await writeFiles(outer, ["pnpm-workspace.yaml"]);
      await expect(discoverWorkspaceCatalogs(outer)).rejects.toThrow(
        /pnpm-workspace\.yaml must be a regular file/u
      );
    } finally {
      await rm(outer, { force: true, recursive: true });
    }
  });
});
