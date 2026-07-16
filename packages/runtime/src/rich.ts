import type { IrNode, JsonObject } from "@openmirai/intl-abi";

import type { RuntimeFormatter } from "./backend";
import { renderPrecompiledNodes } from "./precompiled";

export type RichRenderValue = unknown;
export type RichComponent<RenderValue = RichRenderValue> = (
  children: ReadonlyArray<RenderValue>
) => RenderValue;
export type RichComponentMap<RenderValue = RichRenderValue> = Readonly<
  Record<string, RichComponent<RenderValue>>
>;

type RichState = Readonly<{
  components: RichComponentMap;
  escapeValues: boolean;
  formatters: Readonly<Record<string, RuntimeFormatter>>;
  locale: string;
  pluralValue?: number;
  values: JsonObject;
}>;

function ownOption<Value>(
  options: Readonly<Record<string, Value>>,
  key: string
): Value | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(options, key);
  return descriptor && "value" in descriptor
    ? (descriptor.value as Value)
    : undefined;
}

function renderRichNodes(
  nodes: ReadonlyArray<IrNode>,
  state: RichState
): Array<RichRenderValue> {
  const output: Array<RichRenderValue> = [];
  let plain: Array<IrNode> = [];
  const flushPlain = (): void => {
    if (plain.length === 0) {
      return;
    }
    output.push(
      renderPrecompiledNodes(plain, {
        escapeValues: state.escapeValues,
        formatters: state.formatters,
        locale: state.locale,
        ...(state.pluralValue === undefined
          ? {}
          : { pluralValue: state.pluralValue }),
        values: state.values,
      })
    );
    plain = [];
  };

  for (const node of nodes) {
    if (node.type === "tag") {
      flushPlain();
      const component = ownOption(state.components, node.name);
      if (!component) {
        throw new Error(`Missing trusted rich component ${node.name}`);
      }
      output.push(component(renderRichNodes(node.children, state)));
      continue;
    }
    if (node.type === "select") {
      flushPlain();
      const raw = state.values[node.name];
      if (
        typeof raw !== "string" &&
        typeof raw !== "number" &&
        typeof raw !== "boolean"
      ) {
        throw new TypeError(`${node.name} is not scalar`);
      }
      const option =
        ownOption(node.options, String(raw)) ??
        ownOption(node.options, "other");
      if (!option) {
        throw new Error(`Select ${node.name} has no usable branch`);
      }
      output.push(...renderRichNodes(option, state));
      continue;
    }
    if (node.type === "plural") {
      flushPlain();
      const raw = state.values[node.name];
      if (typeof raw !== "number") {
        throw new TypeError(`${node.name} is not numeric`);
      }
      const exact = ownOption(node.options, `=${raw}`);
      const category = new Intl.PluralRules(state.locale, {
        type: node.pluralType,
      }).select(raw - node.offset);
      const option =
        exact ??
        ownOption(node.options, category) ??
        ownOption(node.options, "other");
      if (!option) {
        throw new Error(`Plural ${node.name} has no usable branch`);
      }
      output.push(
        ...renderRichNodes(option, { ...state, pluralValue: raw - node.offset })
      );
      continue;
    }
    plain.push(node);
  }
  flushPlain();
  return output;
}

export function renderRich(
  nodes: ReadonlyArray<IrNode>,
  input: Omit<RichState, "pluralValue">
): RichRenderValue {
  return renderRichNodes(nodes, input);
}
