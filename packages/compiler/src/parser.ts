import { parse, TYPE } from "@formatjs/icu-messageformat-parser";
import type { MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import type { IrNode, ObjectSchema, ValueSchema } from "@openmirai/intl-abi";

import { canonicalJson, compareCanonicalStrings } from "./canonical";

export type ParsedMessage = Readonly<{
  exactPluralBranches: ReadonlyArray<string>;
  nodes: ReadonlyArray<IrNode>;
  pluralBranches: ReadonlyArray<
    Readonly<{
      categories: ReadonlyArray<string>;
      name: string;
      pluralType: "cardinal" | "ordinal";
    }>
  >;
  signature: Readonly<Record<string, string>>;
  tagCounts: Readonly<Record<string, number>>;
}>;

export type MessageSyntax = Readonly<{
  argumentNames: ReadonlyArray<string>;
  nodes: ReadonlyArray<IrNode>;
  tagNames: ReadonlyArray<string>;
}>;

export type InferredMessageContract = Readonly<{
  formatterIds: ReadonlyArray<string>;
  kind: "rich" | "text";
  tags: ReadonlyArray<string>;
  valuesSchema: ObjectSchema;
}>;

type InferredArgumentRole = "date-time" | "number" | "scalar" | "string";

const currencyStyle = /^currency\/[A-Z]{3}$/u;

function normalizeStyle(
  style: unknown,
  kind: "date" | "number" | "time"
): string | undefined {
  if (style === undefined || style === null) {
    return undefined;
  }
  if (typeof style !== "string") {
    throw new Error(`ICU ${kind} skeleton styles are unsupported`);
  }
  if (style.normalize("NFC") !== style) {
    throw new Error(`ICU ${kind} style must be NFC-normalized`);
  }
  if (kind === "number") {
    if (
      style === "integer" ||
      style === "percent" ||
      currencyStyle.test(style) ||
      style.startsWith("custom:")
    ) {
      return style;
    }
    throw new Error(
      `Unsupported ICU number style ${JSON.stringify(style)}; custom formatters must use custom:${style} syntax`
    );
  }
  if (
    style === "short" ||
    style === "medium" ||
    style === "long" ||
    style === "full" ||
    style.startsWith("custom:")
  ) {
    return style;
  }
  throw new Error(`Unsupported ICU ${kind} style ${JSON.stringify(style)}`);
}

function convertElements(
  elements: ReadonlyArray<MessageFormatElement>
): ReadonlyArray<IrNode> {
  return elements.map((element): IrNode => {
    switch (element.type) {
      case TYPE.literal:
        return { type: "literal", value: element.value.normalize("NFC") };
      case TYPE.argument:
        return { type: "argument", name: element.value };
      case TYPE.number: {
        const style = normalizeStyle(element.style, "number");
        return style
          ? { type: "number", name: element.value, style }
          : { type: "number", name: element.value };
      }
      case TYPE.date: {
        const style = normalizeStyle(element.style, "date");
        return style
          ? { type: "date", name: element.value, style }
          : { type: "date", name: element.value };
      }
      case TYPE.time: {
        const style = normalizeStyle(element.style, "time");
        return style
          ? { type: "time", name: element.value, style }
          : { type: "time", name: element.value };
      }
      case TYPE.select:
        return {
          name: element.value,
          options: Object.fromEntries(
            Object.entries(element.options).map(([key, option]) => [
              key,
              convertElements(option.value),
            ])
          ),
          type: "select",
        };
      case TYPE.plural:
        return {
          name: element.value,
          offset: element.offset,
          options: Object.fromEntries(
            Object.entries(element.options).map(([key, option]) => [
              key,
              convertElements(option.value),
            ])
          ),
          pluralType: element.pluralType ?? "cardinal",
          type: "plural",
        };
      case TYPE.pound:
        return { type: "pound" };
      case TYPE.tag:
        return {
          children: convertElements(element.children),
          name: element.value,
          type: "tag",
        };
    }
  });
}

function walk(
  nodes: ReadonlyArray<IrNode>,
  onNode: (node: IrNode) => void
): void {
  for (const node of nodes) {
    onNode(node);
    if (node.type === "plural" || node.type === "select") {
      for (const option of Object.values(node.options)) {
        walk(option, onNode);
      }
    } else if (node.type === "tag") {
      walk(node.children, onNode);
    }
  }
}

export function inspectMessageSyntax(message: string): MessageSyntax {
  const nodes = convertElements(
    parse(message, { captureLocation: false, ignoreTag: false })
  );
  const argumentNames = new Set<string>();
  const tagNames = new Set<string>();

  walk(nodes, (node) => {
    switch (node.type) {
      case "argument":
      case "date":
      case "number":
      case "plural":
      case "select":
      case "time":
        argumentNames.add(node.name);
        break;
      case "tag":
        tagNames.add(node.name);
        break;
      case "literal":
      case "pound":
        break;
    }
  });

  return {
    argumentNames: [...argumentNames].toSorted(),
    nodes,
    tagNames: [...tagNames].toSorted(),
  };
}

function roleForSchema(
  schema: ObjectSchema,
  name: string
): "date" | "number" | "scalar" | "string" | undefined {
  const property = schema.properties[name];
  if (!property) {
    return undefined;
  }
  if (property.type === "number") {
    return "number";
  }
  if (property.type === "date-time") {
    return "date";
  }
  if (property.type === "scalar") {
    return "scalar";
  }
  if (
    property.type === "string" ||
    property.type === "enum" ||
    property.type === "literal"
  ) {
    return "string";
  }
  return undefined;
}

function mergeInferredRole(
  path: string,
  name: string,
  current: InferredArgumentRole | undefined,
  next: InferredArgumentRole
): InferredArgumentRole {
  if (!current || current === next) {
    return next;
  }
  if (current === "scalar") {
    return next;
  }
  if (next === "scalar") {
    return current;
  }
  throw new Error(
    `${path} argument ${name} has incompatible inferred roles ${current} and ${next}`
  );
}

function inferredSchema(role: InferredArgumentRole): ValueSchema {
  switch (role) {
    case "date-time":
      return { type: "date-time" };
    case "number":
      return { finite: true, type: "number" };
    case "scalar":
      return { type: "scalar" };
    case "string":
      return { type: "string" };
  }
}

function inferredContractForLocale(
  path: string,
  message: string
): InferredMessageContract {
  const syntax = inspectMessageSyntax(message);
  const roles = new Map<string, InferredArgumentRole>();
  const formatterIds = new Set<string>();
  walk(syntax.nodes, (node) => {
    let role: InferredArgumentRole | undefined;
    switch (node.type) {
      case "argument":
        role = "scalar";
        break;
      case "plural":
      case "number":
        role = "number";
        break;
      case "select":
        role = "string";
        break;
      case "date":
      case "time":
        role = "date-time";
        break;
      case "tag":
      case "literal":
      case "pound":
        break;
    }
    if (role && "name" in node) {
      roles.set(
        node.name,
        mergeInferredRole(path, node.name, roles.get(node.name), role)
      );
    }
    if (
      (node.type === "number" ||
        node.type === "date" ||
        node.type === "time") &&
      node.style?.startsWith("custom:")
    ) {
      const formatterId = node.style.split(":")[1];
      if (formatterId) {
        formatterIds.add(formatterId);
      }
    }
  });
  const properties = Object.fromEntries(
    [...roles.entries()]
      .toSorted(([left], [right]) => compareCanonicalStrings(left, right))
      .map(([name, role]) => [name, inferredSchema(role)])
  );
  return {
    formatterIds: [...formatterIds].toSorted(),
    kind: syntax.tagNames.length > 0 ? "rich" : "text",
    tags: syntax.tagNames,
    valuesSchema: {
      additionalProperties: false,
      properties,
      required: Object.keys(properties),
      type: "object",
    },
  };
}

export function inferMessageContract(
  path: string,
  translations: Readonly<Record<string, string>>,
  locales: ReadonlyArray<string>
): InferredMessageContract {
  const inferred = locales.map((locale) => {
    const message = translations[locale];
    if (message === undefined) {
      throw new Error(`${path} is missing locale ${locale}`);
    }
    return [locale, inferredContractForLocale(path, message)] as const;
  });
  const baseline = inferred[0]?.[1];
  if (!baseline) {
    throw new Error(`${path} requires at least one locale`);
  }
  let baselineParsed: ParsedMessage | undefined;
  for (const [locale, current] of inferred) {
    if (
      canonicalJson(current.valuesSchema) !==
      canonicalJson(baseline.valuesSchema)
    ) {
      throw new Error(
        `${path} has incompatible inferred argument contracts in ${locale}`
      );
    }
    if (canonicalJson(current.tags) !== canonicalJson(baseline.tags)) {
      throw new Error(
        `${path} has incompatible inferred rich tags in ${locale}`
      );
    }
    if (
      canonicalJson(current.formatterIds) !==
      canonicalJson(baseline.formatterIds)
    ) {
      throw new Error(
        `${path} has incompatible inferred formatter contracts in ${locale}`
      );
    }
    const parsed = parseMessage(
      translations[locale] ?? "",
      baseline.valuesSchema,
      locale
    );
    baselineParsed ??= parsed;
    if (
      canonicalJson(parsed.signature) !==
        canonicalJson(baselineParsed.signature) ||
      canonicalJson(parsed.exactPluralBranches) !==
        canonicalJson(baselineParsed.exactPluralBranches) ||
      canonicalJson(parsed.tagCounts) !==
        canonicalJson(baselineParsed.tagCounts)
    ) {
      throw new Error(`${path} has incompatible parsed contracts in ${locale}`);
    }
  }
  return baseline;
}

export function parseMessage(
  message: string,
  valuesSchema: ObjectSchema,
  locale: string
): ParsedMessage {
  const nodes = convertElements(
    parse(message, { captureLocation: false, ignoreTag: false })
  );
  const signature = new Map<string, Set<string>>();
  const tagCounts = new Map<string, number>();
  const exactPluralBranches: Array<string> = [];
  const pluralBranches: Array<{
    categories: ReadonlyArray<string>;
    name: string;
    pluralType: "cardinal" | "ordinal";
  }> = [];

  const addSignature = (
    name: string,
    syntaxRole: string,
    schemaRole: "date" | "number" | "string"
  ): void => {
    const declaredRole = roleForSchema(valuesSchema, name);
    if (!declaredRole) {
      throw new Error(`Argument ${name} requires an explicit scalar schema`);
    }
    if (declaredRole !== schemaRole) {
      throw new Error(
        `Argument ${name} expects ${schemaRole} syntax but schema declares ${declaredRole}`
      );
    }
    const roles = signature.get(name) ?? new Set<string>();
    roles.add(syntaxRole);
    signature.set(name, roles);
  };

  walk(nodes, (node) => {
    switch (node.type) {
      case "argument": {
        const role = roleForSchema(valuesSchema, node.name);
        if (!role) {
          throw new Error(
            `Argument ${node.name} requires an inferred scalar schema`
          );
        }
        const roles = signature.get(node.name) ?? new Set<string>();
        roles.add(`argument:${role}`);
        signature.set(node.name, roles);
        break;
      }
      case "number":
        addSignature(node.name, `number:${node.style ?? "default"}`, "number");
        break;
      case "date":
      case "time":
        addSignature(
          node.name,
          `${node.type}:${node.style ?? "default"}`,
          "date"
        );
        break;
      case "select":
        addSignature(node.name, "select", "string");
        if (!Object.hasOwn(node.options, "other")) {
          throw new Error(
            `Select ${node.name} is missing required other branch`
          );
        }
        break;
      case "plural": {
        addSignature(node.name, `plural:${node.pluralType}`, "number");
        if (!Object.hasOwn(node.options, "other")) {
          throw new Error(
            `Plural ${node.name} is missing required other branch`
          );
        }
        const categories = Object.keys(node.options).filter(
          (key) => !key.startsWith("=")
        );
        const allowed = new Set<string>(
          new Intl.PluralRules(locale, {
            type: node.pluralType,
          }).resolvedOptions().pluralCategories
        );
        for (const category of categories) {
          if (category !== "other" && !allowed.has(category)) {
            throw new Error(
              `Plural ${node.name} uses invalid ${category} category for ${locale}`
            );
          }
        }
        for (const key of Object.keys(node.options)) {
          if (key.startsWith("=")) {
            // Keep one entry per syntactic occurrence. A Set would hide locale
            // drift when the same exact selector is repeated in only one
            // translation.
            exactPluralBranches.push(`${node.name}:${key}`);
          }
        }
        pluralBranches.push({
          categories: categories.toSorted(),
          name: node.name,
          pluralType: node.pluralType,
        });
        break;
      }
      case "tag":
        tagCounts.set(node.name, (tagCounts.get(node.name) ?? 0) + 1);
        break;
      case "literal":
      case "pound":
        break;
    }
  });

  const required = new Set(valuesSchema.required);
  for (const name of signature.keys()) {
    if (!required.has(name)) {
      throw new Error(`Argument ${name} must be required by its values schema`);
    }
  }
  for (const name of required) {
    if (!signature.has(name)) {
      throw new Error(
        `Required schema argument ${name} is unused by the message`
      );
    }
  }

  return {
    exactPluralBranches: exactPluralBranches.toSorted(compareCanonicalStrings),
    nodes,
    pluralBranches,
    signature: Object.fromEntries(
      [...signature.entries()]
        .toSorted(([left], [right]) => {
          if (left === right) {
            return 0;
          }
          return left < right ? -1 : 1;
        })
        .map(([name, roles]) => [name, [...roles].toSorted().join("|")])
    ),
    tagCounts: Object.fromEntries([...tagCounts.entries()].toSorted()),
  };
}
