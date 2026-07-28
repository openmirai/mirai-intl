process.once("exit", () => {
  const marker = {
    maxRssBytes: process.resourceUsage().maxRSS * 1024,
    rssBytes: process.memoryUsage().rss,
  };
  process.stderr.write(
    `\nMIRAI_INTL_BENCHMARK_RSS=${JSON.stringify(marker)}\n`
  );
});
