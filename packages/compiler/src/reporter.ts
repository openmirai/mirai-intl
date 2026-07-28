import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { canonicalJson } from "./canonical";

export type CliFormat = "json" | "stylish";
export type CliSeverity = "error" | "warning";

export type CliDiagnostic = Readonly<{
  code: string;
  column?: number;
  file?: string;
  hint?: string;
  line?: number;
  locale?: string;
  message: string;
  path?: string;
  severity: CliSeverity;
}>;

export type ReporterOptions = Readonly<{
  annotations: "github" | undefined;
  color: boolean;
  format: CliFormat;
  reportFile: string | undefined;
}>;

type CliSummaryScalar = boolean | number | string;

export type CliSummary = Readonly<
  Record<
    string,
    CliSummaryScalar | ReadonlyArray<Readonly<Record<string, CliSummaryScalar>>>
  >
>;

export type CliReport = Readonly<{
  command: string;
  diagnostics: ReadonlyArray<CliDiagnostic>;
  rawJson?: unknown;
  schemaVersion: 1;
  success: boolean;
  summary: CliSummary;
}>;

const ANSI = {
  cyan: "\u001b[36m",
  dim: "\u001b[2m",
  green: "\u001b[32m",
  red: "\u001b[31m",
  reset: "\u001b[0m",
  yellow: "\u001b[33m",
} as const;

function colorize(
  enabled: boolean,
  color: keyof typeof ANSI,
  value: string
): string {
  return enabled ? `${ANSI[color]}${value}${ANSI.reset}` : value;
}

function diagnosticLocation(diagnostic: CliDiagnostic): string {
  if (!diagnostic.file) {
    return "";
  }
  const line = diagnostic.line === undefined ? "" : `:${diagnostic.line}`;
  const column = diagnostic.column === undefined ? "" : `:${diagnostic.column}`;
  return `${diagnostic.file}${line}${column}`;
}

function formatDiagnostic(diagnostic: CliDiagnostic, color: boolean): string {
  const severity = diagnostic.severity.toUpperCase();
  const decoratedSeverity = colorize(
    color,
    diagnostic.severity === "error" ? "red" : "yellow",
    severity
  );
  const location = diagnosticLocation(diagnostic);
  const context = [
    diagnostic.locale ? `locale ${diagnostic.locale}` : undefined,
    diagnostic.path ? `path ${diagnostic.path}` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" · ");
  const heading = [
    location ? colorize(color, "cyan", location) : undefined,
    decoratedSeverity,
    colorize(color, "dim", diagnostic.code),
    context || undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" · ");
  return [
    heading,
    `  ${diagnostic.message}`,
    diagnostic.hint
      ? `  ${colorize(color, "dim", `Fix: ${diagnostic.hint}`)}`
      : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join("\n");
}

function githubEscapeProperty(value: string): string {
  return githubEscapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

function githubEscapeData(value: string): string {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

function githubAnnotation(diagnostic: CliDiagnostic): string {
  const properties = [
    diagnostic.file
      ? `file=${githubEscapeProperty(diagnostic.file)}`
      : undefined,
    diagnostic.line === undefined ? undefined : `line=${diagnostic.line}`,
    diagnostic.column === undefined ? undefined : `col=${diagnostic.column}`,
    `title=${githubEscapeProperty(`Mirai Intl ${diagnostic.code}`)}`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(",");
  const message = diagnostic.hint
    ? `${diagnostic.message} Fix: ${diagnostic.hint}`
    : diagnostic.message;
  const propertyBlock = properties ? ` ${properties}` : "";
  return `::${diagnostic.severity === "error" ? "error" : "warning"}${propertyBlock}::${githubEscapeData(message)}`;
}

export async function writeReportFile(
  destination: string,
  report: CliReport
): Promise<void> {
  const path = resolve(destination);
  const reportFile = {
    command: report.command,
    diagnostics: report.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      ...(diagnostic.column === undefined ? {} : { column: diagnostic.column }),
      ...(diagnostic.file
        ? {
            file: isAbsolute(diagnostic.file)
              ? relative(process.cwd(), diagnostic.file)
              : diagnostic.file,
          }
        : {}),
      ...(diagnostic.hint ? { hint: diagnostic.hint } : {}),
      ...(diagnostic.line === undefined ? {} : { line: diagnostic.line }),
      ...(diagnostic.locale ? { locale: diagnostic.locale } : {}),
      message: diagnostic.message,
      ...(diagnostic.path ? { path: diagnostic.path } : {}),
      severity: diagnostic.severity,
    })),
    schemaVersion: report.schemaVersion,
    success: report.success,
  };
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await writeFile(temporary, `${canonicalJson(reportFile)}\n`, "utf8");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function emitReport(
  report: CliReport,
  options: ReporterOptions,
  stylishSummary: string
): Promise<void> {
  if (options.reportFile) {
    await writeReportFile(options.reportFile, report);
  }
  if (options.format === "json") {
    process.stdout.write(
      `${canonicalJson(
        report.rawJson ?? {
          command: report.command,
          diagnostics: report.diagnostics,
          schemaVersion: report.schemaVersion,
          success: report.success,
          summary: report.summary,
        }
      )}\n`
    );
    return;
  }
  if (report.diagnostics.length > 0) {
    process.stdout.write(
      `${report.diagnostics
        .map((diagnostic) => formatDiagnostic(diagnostic, options.color))
        .join("\n\n")}\n`
    );
  }
  if (options.annotations === "github") {
    for (const diagnostic of report.diagnostics) {
      process.stdout.write(`${githubAnnotation(diagnostic)}\n`);
    }
  }
  process.stdout.write(`${stylishSummary}\n`);
}

export function successfulSummary(
  action: string,
  detail: string,
  color: boolean
): string {
  return `mirai-intl ${action} ${colorize(color, "green", "✓")} ${detail}`;
}

export function failedSummary(
  action: string,
  count: number,
  color: boolean
): string {
  const noun = count === 1 ? "error" : "errors";
  return `mirai-intl ${action} ${colorize(color, "red", "✗")} ${count} ${noun}`;
}

export function colorEnabled(
  explicit: boolean | undefined,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  isTTY: boolean = process.stdout.isTTY === true
): boolean {
  if (explicit !== undefined) {
    return explicit;
  }
  if (environment.FORCE_COLOR !== undefined) {
    return !["0", "false"].includes(environment.FORCE_COLOR.toLowerCase());
  }
  if (
    environment.NO_COLOR !== undefined ||
    environment.NODE_DISABLE_COLORS !== undefined
  ) {
    return false;
  }
  return isTTY;
}
