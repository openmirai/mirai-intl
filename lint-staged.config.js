const quote = (file) => `'${file.replaceAll("'", "'\\''")}'`;

const isGeneratedArtifact = (file) =>
  file.includes("/test/generated/") ||
  file.includes("/dist/") ||
  file.endsWith(".gen.mjs") ||
  file.endsWith(".gen.d.mts") ||
  file.endsWith(".gen.d.ts") ||
  file.endsWith(".gen.json");

const jsTsTasks = (files) => {
  const lintable = files.filter((file) => !isGeneratedArtifact(file));
  if (lintable.length === 0) {
    return [];
  }

  const fileArgs = lintable.map(quote).join(" ");

  return [
    `pnpm exec oxlint --fix --quiet ${fileArgs}`,
    `pnpm exec oxfmt --write ${fileArgs}`,
  ];
};

const formatTasks = (files) => {
  const formattable = files.filter((file) => !isGeneratedArtifact(file));
  if (formattable.length === 0) {
    return [];
  }

  return [`pnpm exec oxfmt --write ${formattable.map(quote).join(" ")}`];
};

export default {
  "**/*.{js,jsx,mjs,cjs,ts,tsx}": jsTsTasks,
  "**/*.{json,jsonc}": formatTasks,
};
