import { messageBrand } from "@openmirai/intl-abi";
import type {
  DescriptorInput,
  MessageDescriptor,
  RuntimeMessage,
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
