import { relative } from "node:path";

import ts from "typescript";

export type HardcodedLiteralDiagnostic = Readonly<{
  file: string;
  message: string;
}>;

const USER_FACING_PROPS = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "description",
  "emptyText",
  "helperText",
  "label",
  "placeholder",
  "title",
  "tooltip",
]);

const ALLOW_COMMENT = /mirai-intl-allow-literal\b/u;
const PROSE_LITERAL =
  /(?:[A-Za-z]{2,}(?:\s+[A-Za-z]{2,})+)|(?:[\u0E00-\u0E7F]{2,})/u;
const SKIP_PATH =
  /(?:^|\/)(?:__tests__|__mocks__|__fixtures__|fixtures|stories|storybook)(?:\/|$)|(?:\.test|\.spec|\.stories)\.[cm]?[jt]sx?$/u;
const ZOD_MESSAGE_METHODS = new Set([
  "catch",
  "cuid",
  "datetime",
  "default",
  "email",
  "endsWith",
  "includes",
  "length",
  "max",
  "min",
  "nonempty",
  "nullable",
  "nullish",
  "optional",
  "refine",
  "regex",
  "startsWith",
  "superRefine",
  "toLowerCase",
  "toUpperCase",
  "transform",
  "trim",
  "url",
  "uuid",
]);

export function shouldSkipHardcodedLiteralFile(filePath: string): boolean {
  return SKIP_PATH.test(filePath.replaceAll("\\", "/"));
}

function lineOf(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function hasAllowComment(sourceFile: ts.SourceFile, node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    const ranges = [
      ...(ts.getLeadingCommentRanges(sourceFile.text, current.pos) ?? []),
      ...(ts.getTrailingCommentRanges(sourceFile.text, current.end) ?? []),
    ];
    if (
      ranges.some((range) =>
        ALLOW_COMMENT.test(sourceFile.text.slice(range.pos, range.end))
      )
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function isProseLiteral(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return false;
  }
  return PROSE_LITERAL.test(trimmed);
}

function propName(node: ts.JsxAttribute): string | undefined {
  if (ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  return undefined;
}

function callMethodName(callee: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }
  if (ts.isIdentifier(callee)) {
    return callee.text;
  }
  return undefined;
}

function jsxAttributeStringLiteral(
  initializer: ts.JsxAttribute["initializer"]
): string | undefined {
  if (!initializer) {
    return undefined;
  }
  if (
    ts.isStringLiteral(initializer) ||
    ts.isNoSubstitutionTemplateLiteral(initializer)
  ) {
    return initializer.text;
  }
  if (!ts.isJsxExpression(initializer) || !initializer.expression) {
    return undefined;
  }
  if (
    ts.isStringLiteral(initializer.expression) ||
    ts.isNoSubstitutionTemplateLiteral(initializer.expression)
  ) {
    return initializer.expression.text;
  }
  return undefined;
}

function looksLikeZodMessageArgument(
  sourceFile: ts.SourceFile,
  node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral
): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isCallExpression(current)) {
      const methodName = callMethodName(current.expression);
      if (methodName === undefined || !ZOD_MESSAGE_METHODS.has(methodName)) {
        return false;
      }
      const args = current.arguments;
      if (args.length === 0) {
        return false;
      }
      const last = args.at(-1);
      if (last === node) {
        return isProseLiteral(node.text);
      }
      if (
        last &&
        ts.isObjectLiteralExpression(last) &&
        last.properties.some(
          (property) =>
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === "message" &&
            property.initializer === node
        )
      ) {
        return isProseLiteral(node.text);
      }
      return false;
    }
    current = current.parent;
  }
  return false;
}

export function analyzeHardcodedLiterals(options: {
  filePath: string;
  packageRoot: string;
  source: string;
}): ReadonlyArray<HardcodedLiteralDiagnostic> {
  if (shouldSkipHardcodedLiteralFile(options.filePath)) {
    return [];
  }

  const scriptKind = options.filePath.endsWith("x")
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    options.filePath,
    options.source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );
  const relativeFile = relative(options.packageRoot, options.filePath);
  const diagnostics: Array<HardcodedLiteralDiagnostic> = [];

  const visit = (node: ts.Node): void => {
    if (hasAllowComment(sourceFile, node)) {
      return;
    }

    if (ts.isJsxText(node)) {
      const text = node.getText(sourceFile);
      if (isProseLiteral(text)) {
        diagnostics.push({
          file: relativeFile,
          message: `${lineOf(sourceFile, node.getStart(sourceFile))}: hardcoded JSX text must use t()/t.rich() from locale JSON (or mirai-intl-allow-literal)`,
        });
      }
    }

    if (ts.isJsxAttribute(node)) {
      const name = propName(node);
      if (name && USER_FACING_PROPS.has(name) && node.initializer) {
        const literal = jsxAttributeStringLiteral(node.initializer);
        if (literal !== undefined && isProseLiteral(literal)) {
          diagnostics.push({
            file: relativeFile,
            message: `${lineOf(sourceFile, node.getStart(sourceFile))}: hardcoded ${name} string must use t()/t.rich() from locale JSON (or mirai-intl-allow-literal)`,
          });
        }
      }
    }

    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      looksLikeZodMessageArgument(sourceFile, node)
    ) {
      diagnostics.push({
        file: relativeFile,
        message: `${lineOf(sourceFile, node.getStart(sourceFile))}: hardcoded Zod validation message must use a catalog key via parseTranslationKey/createTranslationKey (or mirai-intl-allow-literal)`,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return diagnostics;
}
