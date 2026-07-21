import type {
  IrNode,
  JsonObject,
  JsonValue,
  RendererCapabilityId,
  RuntimeMessage,
} from "@openmirai/intl-abi";

import { renderRich as renderRichNodes } from "./rich";

export type RuntimeFormatter = Readonly<{
  format: (value: JsonValue, locale: string, options?: string) => string;
  version: string;
}>;

export type RenderRequest = Readonly<{
  escapeValues: boolean;
  formatters: Readonly<Record<string, RuntimeFormatter>>;
  locale: string;
  message: RuntimeMessage;
  precompiledRenderer?: PrecompiledMessageRenderer;
  values: JsonObject;
}>;

export type RendererRichValue = unknown;
export type RendererRichComponent = (
  children: ReadonlyArray<RendererRichValue>
) => RendererRichValue;
export type RendererRichComponentMap = Readonly<
  Record<string, RendererRichComponent>
>;

export type PrecompiledRenderState = Readonly<{
  components?: RendererRichComponentMap;
  escapeValues: boolean;
  formatters: Readonly<Record<string, RuntimeFormatter>>;
  locale: string;
  pluralValue?: number;
  values: JsonObject;
}>;

export type PrecompiledMessageRenderer = (
  state: PrecompiledRenderState
) => JsonValue | RendererRichValue;

export type RendererBackend = Readonly<{
  id: Exclude<RendererCapabilityId, "portable-ir-v1">;
  render: (request: RenderRequest) => JsonValue;
  renderRich?: (
    request: RenderRequest,
    components: RendererRichComponentMap
  ) => RendererRichValue;
  supportsPortableIr: boolean;
}>;

export type TFunctionLike = (
  key: string,
  options?: Readonly<Record<string, unknown>>
) => unknown;

export type TFunctionBridgeOptions = Readonly<{
  customFormatValues?: (request: RenderRequest) => JsonObject;
  resourceExists: (key: string, locale: string) => boolean;
  resolveResourceLocale?: (key: string, locale: string) => string | undefined;
}>;

export const MISSING_RESOURCE_CODE = "missing-resource" as const;

export class MissingResourceError extends Error {
  readonly code = MISSING_RESOURCE_CODE;

  override readonly name = "MissingResourceError";

  constructor(message: string) {
    super(message);
  }
}

export function isMissingResourceError(
  error: unknown
): error is MissingResourceError {
  if (error instanceof MissingResourceError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    "code" in error &&
    (error as { code: unknown }).code === MISSING_RESOURCE_CODE
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function dateArgumentNames(nodes: ReadonlyArray<IrNode>): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (entries: ReadonlyArray<IrNode>): void => {
    for (const node of entries) {
      if (node.type === "date" || node.type === "time") {
        names.add(node.name);
      } else if (node.type === "plural" || node.type === "select") {
        for (const branch of Object.values(node.options)) {
          visit(branch);
        }
      } else if (node.type === "tag") {
        visit(node.children);
      }
    }
  };
  visit(nodes);
  return names;
}

function bridgeValues(
  request: RenderRequest
): Readonly<Record<string, unknown>> {
  const dateNames = dateArgumentNames(
    request.message.localeNodes?.[request.locale] ?? []
  );
  const values = Object.fromEntries(
    Object.entries(request.values).map(([key, value]) => {
      if (dateNames.has(key) && typeof value === "string") {
        const date = new Date(value);
        if (Number.isNaN(date.valueOf())) {
          throw new TypeError(`Invalid date-time value for ${key}`);
        }
        return [key, date];
      }
      return [key, value];
    })
  );
  if (!request.escapeValues) {
    return values;
  }
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      typeof value === "string" ? escapeHtml(value) : value,
    ])
  );
}

export function createTFunctionBridgeBackend(
  t: TFunctionLike,
  options: TFunctionBridgeOptions
): RendererBackend {
  const resourceLocale = (request: RenderRequest): string => {
    if (!options.resourceExists(request.message.path, request.locale)) {
      throw new MissingResourceError("TFunction resource is unavailable");
    }
    const locale =
      options.resolveResourceLocale?.(request.message.path, request.locale) ??
      request.locale;
    if (typeof locale !== "string" || locale.length === 0) {
      throw new TypeError("Resolved TFunction resource locale is invalid");
    }
    return locale;
  };
  return {
    id: "tfunction-bridge-v1",
    render(request) {
      if (request.message.kind === "value") {
        const value = request.message.localeValues?.[request.locale];
        if (value === undefined) {
          throw new MissingResourceError("Missing structured locale value");
        }
        return value;
      }
      const locale = resourceLocale(request);
      const customFormatValues = options.customFormatValues?.(request) ?? {};
      const rendered = t(request.message.path, {
        ...bridgeValues(request),
        ...customFormatValues,
        lng: locale,
      });
      if (typeof rendered !== "string") {
        throw new TypeError("TFunction bridge returned a non-string value");
      }
      return rendered;
    },
    renderRich(request, components) {
      const locale = resourceLocale(request);
      const state = {
        components,
        escapeValues: request.escapeValues,
        formatters: request.formatters,
        locale,
        values: request.values,
      };
      if (request.precompiledRenderer) {
        return request.precompiledRenderer(state);
      }
      const nodes = request.message.localeNodes?.[locale];
      if (!nodes) {
        throw new MissingResourceError(
          "Rich TFunction resource has no normalized message IR"
        );
      }
      return renderRichNodes(nodes, state);
    },
    supportsPortableIr: true,
  };
}
