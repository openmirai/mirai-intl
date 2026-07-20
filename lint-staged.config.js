const quote = (file) => `'${file.replaceAll("'", "'\\''")}'`;

const jsTsTasks = (files) => {
  if (files.length === 0) {
    return [];
  }

  const fileArgs = files.map(quote).join(" ");

  return [
    `pnpm exec oxlint --fix --quiet ${fileArgs}`,
    `pnpm exec oxfmt --write ${fileArgs}`,
  ];
};

const formatTasks = (files) => {
  if (files.length === 0) {
    return [];
  }

  return [`pnpm exec oxfmt --write ${files.map(quote).join(" ")}`];
};

export default {
  "**/*.{js,jsx,mjs,cjs,ts,tsx}": jsTsTasks,
  "**/*.{json,jsonc}": formatTasks,
};
