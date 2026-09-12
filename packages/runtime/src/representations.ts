import {
  defineMessageDescriptor,
  emptyObjectSchema,
  messageBrand,
} from "@openmirai/intl-abi";
import type {
  DescriptorInput,
  DescriptorKind,
  FormatVersion,
  MessageDescriptor,
  ObjectSchema,
  RendererCapabilityId,
  RuntimeAbi,
  RuntimeMessage,
  Sha256,
  ValueSchema,
} from "@openmirai/intl-abi";

import type { PrecompiledMessageRenderer } from "./backend";

const precompiledRendererBrand = Symbol.for(
  "@openmirai/intl-runtime/precompiled-renderer/v1"
);
const embeddedRuntimeMessages = new WeakMap<object, RuntimeMessage>();

export type DescriptorFactory = <
  CatalogId extends string,
  Path extends string,
  Kind extends MessageDescriptor["kind"],
>(
  input: DescriptorInput<CatalogId, Path, Kind>
) => MessageDescriptor<CatalogId, Path, unknown, Kind, unknown, string>;

type DescriptorTable = Readonly<
  Record<string, DescriptorInput<string, string, MessageDescriptor["kind"]>>
>;

export function createDescriptorProxy(
  table: DescriptorTable,
  factory: DescriptorFactory,
  rootPrefix = ""
): unknown {
  const paths = Object.keys(table);
  const cache = new Map<string, unknown>();
  const create = (prefix: string): unknown => {
    const cached = cache.get(prefix);
    if (cached) {
      return cached;
    }
    const proxy = new Proxy(Object.create(null), {
      get(_target, property) {
        if (typeof property !== "string") {
          return undefined;
        }
        const path = prefix ? `${prefix}.${property}` : property;
        const descriptor = table[path];
        if (descriptor) {
          return factory(descriptor);
        }
        return paths.some((candidate) => candidate.startsWith(`${path}.`))
          ? create(path)
          : undefined;
      },
      ownKeys() {
        const start = prefix ? `${prefix}.` : "";
        return [
          ...new Set(
            paths
              .filter((path) => path.startsWith(start))
              .map((path) => path.slice(start.length).split(".")[0])
              .filter((part): part is string => Boolean(part))
          ),
        ];
      },
    });
    cache.set(prefix, proxy);
    return proxy;
  };
  return create(rootPrefix);
}

export type PrecompiledDescriptor<D extends MessageDescriptor> = D &
  ((runtime: StrictDispatcher, values?: unknown) => unknown);

type StrictDispatcher = Readonly<{
  rich: (descriptor: MessageDescriptor, input: unknown) => unknown;
  t: (descriptor: MessageDescriptor, values?: unknown) => string;
  value: (descriptor: MessageDescriptor, values?: unknown) => unknown;
}>;

export function createPrecompiledDescriptor<D extends MessageDescriptor>(
  descriptor: D,
  renderer?: PrecompiledMessageRenderer,
  runtimeMessage?: RuntimeMessage
): PrecompiledDescriptor<D> {
  const callable = (runtime: StrictDispatcher, values?: unknown): unknown => {
    if (descriptor.kind === "text") {
      return runtime.t(descriptor, values);
    }
    if (descriptor.kind === "rich") {
      return runtime.rich(descriptor, values);
    }
    return runtime.value(descriptor, values);
  };
  for (const [key, value] of Object.entries(descriptor)) {
    Object.defineProperty(callable, key, {
      configurable: false,
      enumerable: true,
      value,
      writable: false,
    });
  }
  Object.defineProperty(callable, messageBrand, {
    configurable: false,
    enumerable: false,
    value: descriptor[messageBrand],
    writable: false,
  });
  if (renderer) {
    Object.defineProperty(callable, precompiledRendererBrand, {
      configurable: false,
      enumerable: false,
      value: renderer,
      writable: false,
    });
  }
  if (runtimeMessage) {
    if (
      runtimeMessage.id !== descriptor.messageId ||
      runtimeMessage.path !== descriptor.path ||
      runtimeMessage.kind !== descriptor.kind ||
      runtimeMessage.validatorId !== descriptor.validatorId
    ) {
      throw new TypeError(
        "Embedded runtime message does not match its generated descriptor"
      );
    }
    embeddedRuntimeMessages.set(callable, runtimeMessage);
  }
  return Object.freeze(callable) as PrecompiledDescriptor<D>;
}

export function getEmbeddedRuntimeMessage(
  descriptor: unknown
): RuntimeMessage | undefined {
  if (
    !descriptor ||
    (typeof descriptor !== "object" && typeof descriptor !== "function")
  ) {
    return undefined;
  }
  return embeddedRuntimeMessages.get(descriptor);
}

export function createPrecompiledRuntimeMessage<M extends RuntimeMessage>(
  message: M,
  renderer: PrecompiledMessageRenderer
): M {
  if (
    Object.getPrototypeOf(message) !== Object.prototype ||
    Object.getOwnPropertySymbols(message).length > 0 ||
    typeof renderer !== "function"
  ) {
    throw new TypeError("Precompiled runtime message input is invalid");
  }
  const descriptors = Object.getOwnPropertyDescriptors(message);
  if (Object.values(descriptors).some((property) => !("value" in property))) {
    throw new TypeError("Precompiled runtime message must use data properties");
  }
  const output = Object.defineProperties({}, descriptors);
  Object.defineProperty(output, precompiledRendererBrand, {
    configurable: false,
    enumerable: false,
    value: renderer,
    writable: false,
  });
  return Object.freeze(output) as M;
}

/**
 * Fields that every call site of one generated catalog repeats verbatim. The
 * compiler emits them once per module and the builders below rebuild the exact
 * per-call-site descriptor and runtime message from them.
 */
export type MiraiIntlCallSiteShared = Readonly<{
  buildToken: string;
  capabilitySetHash: Sha256;
  catalogHash: Sha256;
  catalogId: string;
  formatVersion: FormatVersion;
  rendererCapabilityId: RendererCapabilityId;
  runtimeAbi: RuntimeAbi;
}>;

export type MiraiIntlCallSiteProperties = Readonly<Record<string, ValueSchema>>;

export type MiraiIntlCallSites = Readonly<{
  rich: (
    validatorId: number,
    messageId: string,
    path: string,
    renderer: PrecompiledMessageRenderer,
    tags: ReadonlyArray<string>,
    properties?: MiraiIntlCallSiteProperties,
    required?: ReadonlyArray<string>,
    formatterIds?: ReadonlyArray<string>,
    resultSchema?: ValueSchema
  ) => PrecompiledDescriptor<MessageDescriptor>;
  text: (
    validatorId: number,
    messageId: string,
    path: string,
    properties?: MiraiIntlCallSiteProperties,
    required?: ReadonlyArray<string>,
    formatterIds?: ReadonlyArray<string>,
    renderer?: PrecompiledMessageRenderer,
    resultSchema?: ValueSchema
  ) => PrecompiledDescriptor<MessageDescriptor>;
  value: (
    validatorId: number,
    messageId: string,
    path: string,
    renderer: PrecompiledMessageRenderer,
    resultSchema: ValueSchema,
    properties?: MiraiIntlCallSiteProperties,
    required?: ReadonlyArray<string>,
    formatterIds?: ReadonlyArray<string>
  ) => PrecompiledDescriptor<MessageDescriptor>;
}>;

const stringResultSchema = { type: "string" } as const satisfies ValueSchema;
const noCallSiteStrings: ReadonlyArray<string> = Object.freeze([]);

function callSiteArgumentSchema(
  properties: MiraiIntlCallSiteProperties | undefined,
  required: ReadonlyArray<string> | undefined
): ObjectSchema {
  if (!properties && !required) {
    return emptyObjectSchema;
  }
  return {
    additionalProperties: false,
    properties: properties ?? {},
    required: required ?? noCallSiteStrings,
    type: "object",
  };
}

function createCallSite(
  shared: MiraiIntlCallSiteShared,
  kind: DescriptorKind,
  validatorId: number,
  messageId: string,
  path: string,
  argumentSchema: ObjectSchema,
  formatterIds: ReadonlyArray<string>,
  resultSchema: ValueSchema,
  tags: ReadonlyArray<string>,
  renderer: PrecompiledMessageRenderer | undefined
): PrecompiledDescriptor<MessageDescriptor> {
  const descriptor = defineMessageDescriptor({
    buildToken: shared.buildToken,
    capabilitySetHash: shared.capabilitySetHash,
    catalogHash: shared.catalogHash,
    catalogId: shared.catalogId,
    formatVersion: shared.formatVersion,
    kind,
    messageId,
    path,
    rendererCapabilityId: shared.rendererCapabilityId,
    runtimeAbi: shared.runtimeAbi,
    validatorId,
  } satisfies DescriptorInput<string, string, DescriptorKind>);
  const message = {
    argumentSchema,
    formatterIds,
    id: messageId,
    kind,
    path,
    provenanceRef: `message:${messageId}`,
    resultSchema,
    tags,
    validatorId,
  } satisfies RuntimeMessage;
  return createPrecompiledDescriptor(
    descriptor,
    renderer,
    renderer
      ? createPrecompiledRuntimeMessage(message, renderer)
      : Object.freeze(message)
  );
}

/**
 * Build the per-call-site descriptor factories for one generated catalog. The
 * emitted module calls this once and then emits a single factory call per
 * message instead of repeating the seven invariant descriptor fields, the
 * derived runtime-message metadata, and — outside `precompiled-v1` — an unused
 * inline text renderer.
 */
export function createMiraiIntlCallSites(
  shared: MiraiIntlCallSiteShared
): MiraiIntlCallSites {
  const callSites: MiraiIntlCallSites = {
    rich: (
      validatorId,
      messageId,
      path,
      renderer,
      tags,
      properties,
      required,
      formatterIds,
      resultSchema
    ) =>
      createCallSite(
        shared,
        "rich",
        validatorId,
        messageId,
        path,
        callSiteArgumentSchema(properties, required),
        formatterIds ?? noCallSiteStrings,
        resultSchema ?? stringResultSchema,
        tags,
        renderer
      ),
    text: (
      validatorId,
      messageId,
      path,
      properties,
      required,
      formatterIds,
      renderer,
      resultSchema
    ) =>
      createCallSite(
        shared,
        "text",
        validatorId,
        messageId,
        path,
        callSiteArgumentSchema(properties, required),
        formatterIds ?? noCallSiteStrings,
        resultSchema ?? stringResultSchema,
        noCallSiteStrings,
        renderer
      ),
    value: (
      validatorId,
      messageId,
      path,
      renderer,
      resultSchema,
      properties,
      required,
      formatterIds
    ) =>
      createCallSite(
        shared,
        "value",
        validatorId,
        messageId,
        path,
        callSiteArgumentSchema(properties, required),
        formatterIds ?? noCallSiteStrings,
        resultSchema,
        noCallSiteStrings,
        renderer
      ),
  };
  return Object.freeze(callSites);
}

export function getPrecompiledRenderer(
  value: unknown
): PrecompiledMessageRenderer | undefined {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return undefined;
  }
  try {
    const property = Object.getOwnPropertyDescriptor(
      value,
      precompiledRendererBrand
    );
    if (!property || !("value" in property)) {
      return undefined;
    }
    return typeof property.value === "function"
      ? (property.value as PrecompiledMessageRenderer)
      : undefined;
  } catch {
    return undefined;
  }
}
