import type { IrNode, JsonValue } from "@openmirai/intl-abi";

import { renderRich } from "./rich";
import type {
  PrecompiledMessageRenderer,
  PrecompiledRenderState,
  RenderRequest,
  RendererBackend,
  RendererRichComponentMap,
  RendererRichValue,
  RuntimeFormatter,
} from "./backend";

type RenderState = PrecompiledRenderState;

type PrecompiledBranch<Result> = (state: PrecompiledRenderState) => Result;

const customFormatterStyle =
  /^custom:([\dA-Za-z][\dA-Za-z._/-]{0,127})(?::([^:]*))?$/u;
const currencyStyle = /^currency\/([A-Z]{3})$/u;

function ownOption<Value>(
  options: Readonly<Record<string, Value>>,
  key: string
): Value | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(options, key);
  return descriptor && "value" in descriptor
    ? (descriptor.value as Value)
    : undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function scalar(
  value: JsonValue | undefined,
  name: string
): boolean | number | string {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    throw new TypeError(`Argument ${name} is not scalar`);
  }
  return value;
}

function formatCustom(
  value: JsonValue,
  locale: string,
  style: string | undefined,
  formatters: Readonly<Record<string, RuntimeFormatter>>
): string | undefined {
  if (!style?.startsWith("custom:")) {
    return undefined;
  }
  const match = customFormatterStyle.exec(style);
  if (!match) {
    throw new Error("Invalid custom formatter style");
  }
  const [, id, options] = match;
  const formatter = id ? formatters[id] : undefined;
  if (!formatter) {
    throw new Error(`Missing custom formatter ${id ?? ""}`);
  }
  const formatted = formatter.format(value, locale, options);
  if (typeof formatted !== "string") {
    throw new TypeError(`Custom formatter ${id ?? ""} returned a non-string`);
  }
  return formatted;
}

function formatNumber(
  value: number,
  locale: string,
  style: string | undefined,
  formatters: Readonly<Record<string, RuntimeFormatter>>
): string {
  const custom = formatCustom(value, locale, style, formatters);
  if (custom !== undefined) {
    return custom;
  }
  const currency = style ? currencyStyle.exec(style)?.[1] : undefined;
  if (currency) {
    return new Intl.NumberFormat(locale, {
      currency,
      style: "currency",
    }).format(value);
  }
  if (style === "integer") {
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: 0,
    }).format(value);
  }
  if (style === "percent") {
    return new Intl.NumberFormat(locale, { style: "percent" }).format(value);
  }
  if (style === undefined) {
    return new Intl.NumberFormat(locale).format(value);
  }
  throw new Error(`Unsupported number style ${style}`);
}

function dateMonthStyle(
  style: string | undefined
): "long" | "numeric" | "short" {
  if (style === "medium") {
    return "short";
  }
  if (style === "long" || style === "full") {
    return "long";
  }
  return "numeric";
}

function formatDate(
  value: string,
  locale: string,
  style: string | undefined,
  kind: "date" | "time",
  formatters: Readonly<Record<string, RuntimeFormatter>>
): string {
  const custom = formatCustom(value, locale, style, formatters);
  if (custom !== undefined) {
    return custom;
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new TypeError("Invalid date-time value");
  }
  if (
    style !== undefined &&
    style !== "short" &&
    style !== "medium" &&
    style !== "long" &&
    style !== "full"
  ) {
    throw new Error(`Unsupported ${kind} style ${style}`);
  }
  if (kind === "time") {
    return new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
      ...(style === "short" ? {} : { second: "2-digit" }),
      timeZone: "UTC",
      ...(style === "long" ? { timeZoneName: "short" } : {}),
      ...(style === "full" ? { timeZoneName: "long" } : {}),
    }).format(date);
  }
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: dateMonthStyle(style),
    timeZone: "UTC",
    ...(style === "full" ? { weekday: "long" } : {}),
    year: style === "short" ? "2-digit" : "numeric",
  }).format(date);
}

function renderNodes(nodes: ReadonlyArray<IrNode>, state: RenderState): string {
  let output = "";
  for (const node of nodes) {
    switch (node.type) {
      case "literal":
        output += node.value;
        break;
      case "argument": {
        const value = String(scalar(state.values[node.name], node.name));
        output += state.escapeValues ? escapeHtml(value) : value;
        break;
      }
      case "number": {
        const value = scalar(state.values[node.name], node.name);
        if (typeof value !== "number") {
          throw new TypeError(`${node.name} is not numeric`);
        }
        output += formatNumber(
          value,
          state.locale,
          node.style,
          state.formatters
        );
        break;
      }
      case "date":
      case "time": {
        const value = scalar(state.values[node.name], node.name);
        if (typeof value !== "string") {
          throw new TypeError(`${node.name} is not a date string`);
        }
        output += formatDate(
          value,
          state.locale,
          node.style,
          node.type,
          state.formatters
        );
        break;
      }
      case "select": {
        const value = String(scalar(state.values[node.name], node.name));
        const option =
          ownOption(node.options, value) ?? ownOption(node.options, "other");
        if (!option) {
          throw new Error(`Select ${node.name} has no usable branch`);
        }
        output += renderNodes(option, state);
        break;
      }
      case "plural": {
        const value = scalar(state.values[node.name], node.name);
        if (typeof value !== "number") {
          throw new TypeError(`${node.name} is not numeric`);
        }
        const exact = ownOption(node.options, `=${value}`);
        const category = new Intl.PluralRules(state.locale, {
          type: node.pluralType,
        }).select(value - node.offset);
        const option =
          exact ??
          ownOption(node.options, category) ??
          ownOption(node.options, "other");
        if (!option) {
          throw new Error(`Plural ${node.name} has no usable branch`);
        }
        output += renderNodes(option, {
          ...state,
          pluralValue: value - node.offset,
        });
        break;
      }
      case "pound":
        if (state.pluralValue === undefined) {
          throw new Error("# used outside plural context");
        }
        output += new Intl.NumberFormat(state.locale).format(state.pluralValue);
        break;
      case "tag":
        output += `<${node.name}>${renderNodes(node.children, state)}</${node.name}>`;
        break;
    }
  }
  return output;
}

function renderPrecompiled(request: RenderRequest): JsonValue {
  if (request.message.kind === "value") {
    const value = request.message.localeValues?.[request.locale];
    if (value === undefined) {
      throw new Error("Missing structured locale value");
    }
    return value;
  }
  const nodes = request.message.localeNodes?.[request.locale];
  if (!nodes) {
    throw new Error("Missing normalized locale message");
  }
  return renderNodes(nodes, {
    escapeValues: request.escapeValues,
    formatters: request.formatters,
    locale: request.locale,
    values: request.values,
  });
}

function stateFromRequest(
  request: RenderRequest,
  components?: RendererRichComponentMap
): PrecompiledRenderState {
  return {
    ...(components ? { components } : {}),
    escapeValues: request.escapeValues,
    formatters: request.formatters,
    locale: request.locale,
    values: request.values,
  };
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  if (![null, Object.prototype].includes(Object.getPrototypeOf(value))) {
    return false;
  }
  return Object.values(value).every(isJsonValue);
}

export function createPrecompiledLocaleRenderer(
  renderers: Readonly<Record<string, PrecompiledMessageRenderer>>
): PrecompiledMessageRenderer {
  return (state) => {
    const renderer = renderers[state.locale];
    if (!renderer) {
      throw new Error(`Missing precompiled locale renderer ${state.locale}`);
    }
    return renderer(state);
  };
}

export function renderPrecompiledArgument(
  state: PrecompiledRenderState,
  name: string
): string {
  const value = String(scalar(state.values[name], name));
  return state.escapeValues ? escapeHtml(value) : value;
}

export function renderPrecompiledNumber(
  state: PrecompiledRenderState,
  name: string,
  style?: string
): string {
  const value = scalar(state.values[name], name);
  if (typeof value !== "number") {
    throw new TypeError(`${name} is not numeric`);
  }
  return formatNumber(value, state.locale, style, state.formatters);
}

export function renderPrecompiledDate(
  state: PrecompiledRenderState,
  name: string,
  style?: string
): string {
  const value = scalar(state.values[name], name);
  if (typeof value !== "string") {
    throw new TypeError(`${name} is not a date string`);
  }
  return formatDate(value, state.locale, style, "date", state.formatters);
}

export function renderPrecompiledTime(
  state: PrecompiledRenderState,
  name: string,
  style?: string
): string {
  const value = scalar(state.values[name], name);
  if (typeof value !== "string") {
    throw new TypeError(`${name} is not a date string`);
  }
  return formatDate(value, state.locale, style, "time", state.formatters);
}

export function renderPrecompiledPound(state: PrecompiledRenderState): string {
  if (state.pluralValue === undefined) {
    throw new Error("# used outside plural context");
  }
  return new Intl.NumberFormat(state.locale).format(state.pluralValue);
}

export function renderPrecompiledSelect<Result>(
  state: PrecompiledRenderState,
  name: string,
  options: Readonly<Record<string, PrecompiledBranch<Result>>>
): Result {
  const value = String(scalar(state.values[name], name));
  const branch = ownOption(options, value) ?? ownOption(options, "other");
  if (!branch) {
    throw new Error(`Select ${name} has no usable branch`);
  }
  return branch(state);
}

export function renderPrecompiledPlural<Result>(
  state: PrecompiledRenderState,
  name: string,
  pluralType: "cardinal" | "ordinal",
  offset: number,
  options: Readonly<Record<string, PrecompiledBranch<Result>>>
): Result {
  const value = scalar(state.values[name], name);
  if (typeof value !== "number") {
    throw new TypeError(`${name} is not numeric`);
  }
  const exact = ownOption(options, `=${value}`);
  const category = new Intl.PluralRules(state.locale, {
    type: pluralType,
  }).select(value - offset);
  const branch =
    exact ?? ownOption(options, category) ?? ownOption(options, "other");
  if (!branch) {
    throw new Error(`Plural ${name} has no usable branch`);
  }
  return branch({ ...state, pluralValue: value - offset });
}

export function renderPrecompiledComponent(
  state: PrecompiledRenderState,
  name: string,
  children: ReadonlyArray<RendererRichValue>
): RendererRichValue {
  const component = state.components?.[name];
  if (!component) {
    throw new Error(`Missing trusted rich component ${name}`);
  }
  return component(children);
}

export function createPrecompiledBackend(): RendererBackend {
  return {
    id: "precompiled-v1",
    render(request) {
      if (!request.precompiledRenderer) {
        return renderPrecompiled(request);
      }
      const rendered = request.precompiledRenderer(stateFromRequest(request));
      if (request.message.kind === "text" && typeof rendered === "string") {
        return rendered;
      }
      if (request.message.kind === "value" && isJsonValue(rendered)) {
        return rendered;
      }
      throw new TypeError("Precompiled renderer returned an invalid value");
    },
    renderRich(request, components) {
      if (request.precompiledRenderer) {
        return request.precompiledRenderer(
          stateFromRequest(request, components)
        );
      }
      const nodes = request.message.localeNodes?.[request.locale];
      if (!nodes) {
        throw new Error("Missing normalized rich locale message");
      }
      return renderRich(nodes, {
        components,
        escapeValues: request.escapeValues,
        formatters: request.formatters,
        locale: request.locale,
        values: request.values,
      });
    },
    supportsPortableIr: true,
  };
}

export { renderNodes as renderPrecompiledNodes };
