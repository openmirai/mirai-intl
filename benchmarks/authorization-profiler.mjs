import { register } from "node:module";

const counters = {
  createAbstractBuilder: 0,
  createEmitAndSemanticDiagnosticsBuilderProgram: 0,
  createIncrementalProgram: 0,
  createLanguageService: 0,
  createProgram: 0,
  createSemanticDiagnosticsBuilderProgram: 0,
  createSolutionBuilder: 0,
  createWatchProgram: 0,
};
globalThis[Symbol.for("mirai-intl.benchmark.counters")] = counters;
register(
  new URL("./authorization-profiler-loader.mjs", import.meta.url),
  import.meta.url
);

process.once("exit", () => {
  const marker = {
    counters,
    maxRssBytes: process.resourceUsage().maxRSS * 1024,
    rssBytes: process.memoryUsage().rss,
  };
  process.stderr.write(
    `\nMIRAI_INTL_BENCHMARK_PROFILE=${JSON.stringify(marker)}\n`
  );
});
