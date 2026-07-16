import type {
  IrNode,
  JsonObject,
  MessageDescriptor,
  ObjectSchema,
  RuntimeMessage,
  ValueSchema,
} from "@openmirai/intl-abi";

import { canonicalJson, compareCanonicalStrings, sha256 } from "./canonical";
import type { CompileOutput } from "./compile";

export type DescriptorRepresentation = "constants" | "precompiled" | "proxy";

export type EmitOptions = Readonly<{
  compact?: boolean;
}>;

type ArtifactMap = Readonly<Record<string, string>>;

export type EmittedArtifacts = ArtifactMap &
  Readonly<{
    "catalog.contract.gen.json": string;
    "catalog.manifest.gen.d.mts": string;
    "catalog.manifest.gen.mjs": string;
    "catalog.provenance.gen.json": string;
    "catalog.resources.gen.d.mts": string;
    "catalog.resources.gen.mjs": string;
    "catalog.runtime.gen.json": string;
    "catalog.schema.gen.d.ts": string;
  }>;

export type LegacyEmittedArtifacts = EmittedArtifacts &
  Readonly<{
    "catalog.descriptors.gen.d.mts": string;
    "catalog.descriptors.gen.mjs": string;
  }>;

type CompactExport = Readonly<{
  descriptorExport: string;
  module: string;
  path: string;
  runtimeExport: string;
}>;

const privateMessagesModuleName = "catalog.messages.gen.mjs";

interface TreeNode {
  children: Map<string, TreeNode>;
  leaf?: number;
}

const compactDeclarationGroupLimit = 128;
const compactTypeNameAlphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function createTree(
  messages: ReadonlyArray<RuntimeMessage>,
  indexOffset = 0
): TreeNode {
  const root: TreeNode = { children: new Map() };
  messages.forEach((message, index) => {
    let current = root;
    for (const part of message.path.split(".")) {
      const child = current.children.get(part) ?? { children: new Map() };
      current.children.set(part, child);
      current = child;
    }
    current.leaf = index + indexOffset;
  });
  return root;
}

function schemaType(schema: ValueSchema): string {
  switch (schema.type) {
    case "scalar":
      return "string | number";
    case "string":
    case "date-time":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "literal":
      return JSON.stringify(schema.value);
    case "enum":
      return schema.values.map((value) => JSON.stringify(value)).join(" | ");
    case "array":
      return `readonly (${schemaType(schema.items)})[]`;
    case "object":
      return objectSchemaType(schema);
  }
}

function objectSchemaType(schema: ObjectSchema): string {
  const required = new Set(schema.required);
  const properties = Object.entries(schema.properties)
    .toSorted(([left], [right]) => compareCanonicalStrings(left, right))
    .map(
      ([key, value]) =>
        `readonly ${JSON.stringify(key)}${required.has(key) ? "" : "?"}: ${schemaType(value)};`
    );
  return `{ ${properties.join(" ")} }`;
}

function descriptorType(catalogId: string, message: RuntimeMessage): string {
  const values = objectSchemaType(message.argumentSchema);
  const base = `${values}, ${JSON.stringify(catalogId)}, ${JSON.stringify(message.path)}`;
  if (message.kind === "text") {
    return `TextDescriptor<${base}>`;
  }
  if (message.kind === "rich") {
    const tags = message.tags.length
      ? message.tags.map((tag) => JSON.stringify(tag)).join(" | ")
      : "never";
    return `RichDescriptor<${values}, ${tags}, ${JSON.stringify(catalogId)}, ${JSON.stringify(message.path)}>`;
  }
  return `ValueDescriptor<${values}, ${schemaType(message.resultSchema)}, ${JSON.stringify(catalogId)}, ${JSON.stringify(message.path)}>`;
}

function emitTypeTree(
  node: TreeNode,
  messages: ReadonlyArray<RuntimeMessage>,
  catalogId: string,
  indent: string
): string {
  if (node.leaf !== undefined) {
    const message = messages[node.leaf];
    if (!message) {
      throw new Error("Descriptor tree points to a missing message");
    }
    return descriptorType(catalogId, message);
  }
  const nextIndent = `${indent}  `;
  const fields = [...node.children.entries()]
    .toSorted(([left], [right]) => compareCanonicalStrings(left, right))
    .map(
      ([key, child]) =>
        `${nextIndent}readonly ${JSON.stringify(key)}: ${emitTypeTree(child, messages, catalogId, nextIndent)};`
    );
  return `{\n${fields.join("\n")}\n${indent}}`;
}

function descriptorInput(descriptor: MessageDescriptor): string {
  const { brand: _brand, ...input } = descriptor;
  return canonicalJson(input);
}

function emitReferenceTree(
  node: TreeNode,
  messages: ReadonlyArray<RuntimeMessage>,
  indent: string,
  compact: boolean
): string {
  if (node.leaf !== undefined) {
    const message = messages[node.leaf];
    if (!message) {
      throw new Error("Descriptor tree points to a missing message");
    }
    return messageExportName(message.path, node.leaf, compact);
  }
  const nextIndent = `${indent}  `;
  const fields = [...node.children.entries()]
    .toSorted(([left], [right]) => compareCanonicalStrings(left, right))
    .map(
      ([key, child]) =>
        `${nextIndent}${JSON.stringify(key)}: ${emitReferenceTree(child, messages, nextIndent, compact)},`
    );
  return `{\n${fields.join("\n")}\n${indent}}`;
}

function emitStyleArgument(style: string | undefined): string {
  return style ? `, ${JSON.stringify(style)}` : "";
}

function emitObjectProperty(key: string): string {
  return key === "__proto__" ? `[${JSON.stringify(key)}]` : JSON.stringify(key);
}

function emitTextNodes(nodes: ReadonlyArray<IrNode>): string {
  if (nodes.length === 0) {
    return '""';
  }
  return nodes
    .map((node): string => {
      switch (node.type) {
        case "literal":
          return JSON.stringify(node.value);
        case "argument":
          return `renderPrecompiledArgument(state, ${JSON.stringify(node.name)})`;
        case "number":
          return `renderPrecompiledNumber(state, ${JSON.stringify(node.name)}${emitStyleArgument(node.style)})`;
        case "date":
          return `renderPrecompiledDate(state, ${JSON.stringify(node.name)}${emitStyleArgument(node.style)})`;
        case "time":
          return `renderPrecompiledTime(state, ${JSON.stringify(node.name)}${emitStyleArgument(node.style)})`;
        case "pound":
          return "renderPrecompiledPound(state)";
        case "select":
          return `renderPrecompiledSelect(state, ${JSON.stringify(node.name)}, ${emitTextBranches(node.options)})`;
        case "plural":
          return `renderPrecompiledPlural(state, ${JSON.stringify(node.name)}, ${JSON.stringify(node.pluralType)}, ${node.offset}, ${emitTextBranches(node.options)})`;
        case "tag":
          throw new Error(
            `Text precompiler cannot emit rich tag ${node.name} as a string`
          );
      }
    })
    .map((part) => `(${part})`)
    .join(" + ");
}

function emitTextBranches(
  options: Readonly<Record<string, ReadonlyArray<IrNode>>>
): string {
  const branches = Object.entries(options)
    .toSorted(([left], [right]) => compareCanonicalStrings(left, right))
    .map(
      ([key, nodes]) =>
        `${emitObjectProperty(key)}: (state) => ${emitTextNodes(nodes)}`
    );
  return `{ ${branches.join(", ")} }`;
}

function emitRichNodes(nodes: ReadonlyArray<IrNode>): string {
  const parts: Array<string> = [];
  let plain: Array<IrNode> = [];
  const flushPlain = (): void => {
    if (plain.length > 0) {
      parts.push(emitTextNodes(plain));
      plain = [];
    }
  };

  for (const node of nodes) {
    if (node.type === "tag") {
      flushPlain();
      parts.push(
        `renderPrecompiledComponent(state, ${JSON.stringify(node.name)}, ${emitRichNodes(node.children)})`
      );
      continue;
    }
    if (node.type === "select") {
      flushPlain();
      parts.push(
        `...renderPrecompiledSelect(state, ${JSON.stringify(node.name)}, ${emitRichBranches(node.options)})`
      );
      continue;
    }
    if (node.type === "plural") {
      flushPlain();
      parts.push(
        `...renderPrecompiledPlural(state, ${JSON.stringify(node.name)}, ${JSON.stringify(node.pluralType)}, ${node.offset}, ${emitRichBranches(node.options)})`
      );
      continue;
    }
    plain.push(node);
  }
  flushPlain();
  return `[${parts.join(", ")}]`;
}

function emitRichBranches(
  options: Readonly<Record<string, ReadonlyArray<IrNode>>>
): string {
  const branches = Object.entries(options)
    .toSorted(([left], [right]) => compareCanonicalStrings(left, right))
    .map(
      ([key, nodes]) =>
        `${emitObjectProperty(key)}: (state) => ${emitRichNodes(nodes)}`
    );
  return `{ ${branches.join(", ")} }`;
}

function emitPrecompiledRenderer(message: RuntimeMessage): string {
  if (message.kind === "value") {
    const renderers = Object.entries(message.localeValues ?? {})
      .toSorted(([left], [right]) => compareCanonicalStrings(left, right))
      .map(
        ([locale, value]) =>
          `${JSON.stringify(locale)}: () => (${canonicalJson(value)})`
      );
    return `createPrecompiledLocaleRenderer({ ${renderers.join(", ")} })`;
  }
  const renderers = Object.entries(message.localeNodes ?? {})
    .toSorted(([left], [right]) => compareCanonicalStrings(left, right))
    .map(([locale, nodes]) => {
      const body =
        message.kind === "rich" ? emitRichNodes(nodes) : emitTextNodes(nodes);
      return `${JSON.stringify(locale)}: (state) => ${body}`;
    });
  return `createPrecompiledLocaleRenderer({ ${renderers.join(", ")} })`;
}

function encodeExportPart(value: string): string {
  return [...value]
    .map((character) =>
      /^[\dA-Za-z]$/u.test(character)
        ? character
        : `_u${character.codePointAt(0)?.toString(16) ?? "0"}_`
    )
    .join("");
}

export function semanticMessageExportName(path: string): string {
  const readable = path.split(".").map(encodeExportPart).join("__");
  return `message_${readable}_${sha256(path).slice(7, 23)}`;
}

function namespaceExportName(namespace: string): string {
  return `namespace_${encodeExportPart(namespace)}`;
}

function messageExportName(
  path: string,
  index: number,
  compact: boolean
): string {
  return compact
    ? `m${index}`
    : `message_${path.split(".").map(encodeExportPart).join("_")}`;
}

function runtimeMessageExportName(
  path: string,
  index: number,
  compact: boolean
): string {
  return compact
    ? `r${index}`
    : `runtimeMessage_${path.split(".").map(encodeExportPart).join("_")}`;
}

function precompiledRendererName(
  path: string,
  index: number,
  compact: boolean
): string {
  return compact
    ? `p${index}`
    : `precompiledRenderer_${path.split(".").map(encodeExportPart).join("_")}`;
}

function runtimeMessageInput(
  message: RuntimeMessage,
  representation: DescriptorRepresentation
): string {
  if (representation !== "precompiled") {
    return canonicalJson(message);
  }
  return canonicalJson(
    Object.fromEntries(
      Object.entries(message).filter(
        ([key]) => key !== "localeNodes" && key !== "localeValues"
      )
    )
  );
}

function rootEntries(tree: TreeNode): ReadonlyArray<[string, TreeNode]> {
  return [...tree.children.entries()].toSorted(([left], [right]) =>
    compareCanonicalStrings(left, right)
  );
}

function emitCatalogTree(root: ReadonlyArray<[string, TreeNode]>): string {
  const fields = root.map(
    ([key]) => `  ${JSON.stringify(key)}: ${namespaceExportName(key)},`
  );
  return `export const catalogTree = {\n${fields.join("\n")}\n};`;
}

function emitProxyNamespace(
  key: string,
  node: TreeNode,
  output: CompileOutput,
  compact: boolean
): ReadonlyArray<string> {
  const exportName = namespaceExportName(key);
  if (node.leaf !== undefined) {
    const message = output.catalog.messages[node.leaf];
    if (!message) {
      throw new Error(`Proxy namespace ${key} points to a missing descriptor`);
    }
    return [
      `export const ${exportName} = ${messageExportName(message.path, node.leaf, compact)};`,
    ];
  }
  const table = Object.fromEntries(
    output.descriptors
      .filter((descriptor) => descriptor.path.startsWith(`${key}.`))
      .map((descriptor) => [
        descriptor.path,
        JSON.parse(descriptorInput(descriptor)),
      ])
  );
  const tableName = `table_${exportName}`;
  return [
    `const ${tableName} = ${canonicalJson(table)};`,
    `export const ${exportName} = /* @__PURE__ */ createDescriptorProxy(${tableName}, defineMessageDescriptor, ${JSON.stringify(key)});`,
  ];
}

function emitMessageExports(
  output: CompileOutput,
  representation: DescriptorRepresentation,
  compact: boolean
): ReadonlyArray<string> {
  return output.catalog.messages.flatMap((message, index) => {
    const descriptor = output.descriptors[index];
    if (!descriptor) {
      throw new Error(`Message ${message.path} has no descriptor`);
    }
    const defined = `/* @__PURE__ */ defineMessageDescriptor(${descriptorInput(descriptor)})`;
    const descriptorName = messageExportName(message.path, index, compact);
    const runtimeName = runtimeMessageExportName(message.path, index, compact);
    if (representation === "precompiled") {
      const rendererName = precompiledRendererName(
        message.path,
        index,
        compact
      );
      return [
        `const ${rendererName} = /* @__PURE__ */ ${emitPrecompiledRenderer(message)};`,
        `export const ${runtimeName} = /* @__PURE__ */ createPrecompiledRuntimeMessage(${runtimeMessageInput(message, representation)}, ${rendererName});`,
        `export const ${descriptorName} = /* @__PURE__ */ createPrecompiledDescriptor(${defined}, ${rendererName}, ${runtimeName});`,
      ];
    }
    return [
      `export const ${runtimeName} = ${runtimeMessageInput(message, representation)};`,
      `export const ${descriptorName} = ${defined};`,
    ];
  });
}

function emitPrivateMessagesModule(
  output: CompileOutput,
  representation: DescriptorRepresentation
): string {
  if (output.catalog.messages.length === 0) {
    return "";
  }
  const imports =
    representation === "precompiled"
      ? [
          'import { defineMessageDescriptor } from "@openmirai/intl-abi";',
          'import { createPrecompiledDescriptor, createPrecompiledLocaleRenderer, createPrecompiledRuntimeMessage, renderPrecompiledArgument, renderPrecompiledComponent, renderPrecompiledDate, renderPrecompiledNumber, renderPrecompiledPlural, renderPrecompiledPound, renderPrecompiledSelect, renderPrecompiledTime } from "@openmirai/intl-runtime";',
        ]
      : ['import { defineMessageDescriptor } from "@openmirai/intl-abi";'];
  return [
    ...imports,
    "",
    ...emitMessageExports(output, representation, true).flatMap((entry) => [
      entry,
      "",
    ]),
  ].join("\n");
}

function emitDescriptorModule(
  output: CompileOutput,
  representation: DescriptorRepresentation,
  compact: boolean
): string {
  const tree = createTree(output.catalog.messages);
  const root = rootEntries(tree);
  if (representation === "proxy") {
    return [
      'import { defineMessageDescriptor } from "@openmirai/intl-abi";',
      'import { createDescriptorProxy } from "@openmirai/intl-runtime";',
      "",
      `export const catalogManifest = ${canonicalJson(output.catalog.manifest)};`,
      ...emitMessageExports(output, representation, compact).flatMap(
        (entry) => ["", entry]
      ),
      ...root.flatMap(([key, node]) => [
        "",
        ...emitProxyNamespace(key, node, output, compact),
      ]),
      "",
      emitCatalogTree(root),
      "",
    ].join("\n");
  }

  const precompiled = representation === "precompiled";
  const imports = precompiled
    ? [
        'import { defineMessageDescriptor } from "@openmirai/intl-abi";',
        'import { createPrecompiledDescriptor, createPrecompiledLocaleRenderer, createPrecompiledRuntimeMessage, renderPrecompiledArgument, renderPrecompiledComponent, renderPrecompiledDate, renderPrecompiledNumber, renderPrecompiledPlural, renderPrecompiledPound, renderPrecompiledSelect, renderPrecompiledTime } from "@openmirai/intl-runtime";',
      ]
    : ['import { defineMessageDescriptor } from "@openmirai/intl-abi";'];
  const namespaceExports = root.map(
    ([key, node]) =>
      `export const ${namespaceExportName(key)} = ${emitReferenceTree(
        node,
        output.catalog.messages,
        "",
        compact
      )};`
  );
  return [
    ...imports,
    "",
    `export const catalogManifest = ${canonicalJson(output.catalog.manifest)};`,
    ...emitMessageExports(output, representation, compact).flatMap((entry) => [
      "",
      entry,
    ]),
    ...namespaceExports.flatMap((entry) => ["", entry]),
    "",
    emitCatalogTree(root),
    "",
  ].join("\n");
}

function compactLeafTuple(message: RuntimeMessage, index: number): string {
  const values = objectSchemaType(message.argumentSchema);
  if (message.kind === "text") {
    return message.argumentSchema.required.length === 0 &&
      Object.keys(message.argumentSchema.properties).length === 0
      ? `[${index},0]`
      : `[${index},0,${values}]`;
  }
  if (message.kind === "rich") {
    const tags = message.tags.length
      ? message.tags.map((tag) => JSON.stringify(tag)).join(" | ")
      : "never";
    return `[${index},1,${values},${tags}]`;
  }
  return `[${index},2,${values},${schemaType(message.resultSchema)}]`;
}

function compactPropertyName(value: string): string {
  return /^[$A-Z_a-z][$\w]*$/u.test(value) ? value : JSON.stringify(value);
}

function compactTypeName(index: number): string {
  let remaining = index;
  let name = "";
  do {
    name =
      compactTypeNameAlphabet[remaining % compactTypeNameAlphabet.length] +
      name;
    remaining = Math.floor(remaining / compactTypeNameAlphabet.length) - 1;
  } while (remaining >= 0);
  return name;
}

type CompactDeclarationGroup = Readonly<{
  messageIndices: ReadonlyArray<number>;
  prefix: ReadonlyArray<string>;
}>;

function compactDeclarationGroups(
  messages: ReadonlyArray<RuntimeMessage>
): ReadonlyArray<CompactDeclarationGroup> {
  const entries = messages.map((message, index) => ({
    index,
    parent: message.path.split(".").slice(0, -1),
  }));
  const split = (
    groupEntries: typeof entries,
    depth: number
  ): ReadonlyArray<CompactDeclarationGroup> => {
    const prefix = groupEntries[0]?.parent.slice(0, depth) ?? [];
    if (groupEntries.length <= compactDeclarationGroupLimit) {
      return [
        {
          messageIndices: groupEntries.map((entry) => entry.index),
          prefix,
        },
      ];
    }
    const children = new Map<string, typeof entries>();
    for (const entry of groupEntries) {
      const nextDepth = Math.min(depth + 1, entry.parent.length);
      const childPrefix = entry.parent.slice(0, nextDepth);
      const key = canonicalJson(childPrefix);
      const child = children.get(key) ?? [];
      child.push(entry);
      children.set(key, child);
    }
    if (children.size <= 1) {
      const child = children.values().next().value;
      const childDepth = Math.min(
        depth + 1,
        child?.[0]?.parent.length ?? depth
      );
      if (child && childDepth > depth) {
        return split(child, childDepth);
      }
      return [
        { messageIndices: groupEntries.map(({ index }) => index), prefix },
      ];
    }
    return [...children.entries()]
      .toSorted(([left], [right]) => compareCanonicalStrings(left, right))
      .flatMap(([, child]) =>
        split(child, Math.min(depth + 1, child[0]?.parent.length ?? depth))
      );
  };
  const roots = new Map<string, typeof entries>();
  for (const entry of entries) {
    const depth = Math.min(2, entry.parent.length);
    const prefix = entry.parent.slice(0, depth);
    const key = canonicalJson(prefix);
    const group = roots.get(key) ?? [];
    group.push(entry);
    roots.set(key, group);
  }
  return [...roots.entries()]
    .toSorted(([left], [right]) => compareCanonicalStrings(left, right))
    .flatMap(([, entriesForRoot]) =>
      split(entriesForRoot, Math.min(2, entriesForRoot[0]?.parent.length ?? 0))
    );
}

function emitCompactSchemaTree(
  node: TreeNode,
  messages: ReadonlyArray<RuntimeMessage>,
  _indent: string
): string {
  if (node.leaf !== undefined) {
    const message = messages[node.leaf];
    if (!message) {
      throw new Error("Compact descriptor tree points to a missing message");
    }
    return compactLeafTuple(message, node.leaf);
  }
  const fields = [...node.children.entries()]
    .toSorted(([left], [right]) => compareCanonicalStrings(left, right))
    .map(
      ([key, child]) =>
        `${compactPropertyName(key)}:${emitCompactSchemaTree(child, messages, "")}`
    );
  return `{${fields.join(";")}}`;
}

function emitCompactContractDeclaration(
  output: CompileOutput,
  tree: TreeNode
): string {
  const schema = emitCompactSchemaTree(tree, output.catalog.messages, "");
  return [
    'import type { RichDescriptor, TextDescriptor, ValueDescriptor } from "@openmirai/intl-abi";',
    "",
    "type _L=readonly[number,0]|readonly[number,0,object]|readonly[number,1,object,string]|readonly[number,2,object,unknown];",
    'type _J<P extends string,K extends string>=P extends ""?K:`${P}.${K}`;',
    `type _D<X extends _L,P extends string>=X extends readonly[number,0,infer V extends object]?TextDescriptor<V,${JSON.stringify(output.catalog.manifest.catalogId)},P>:X extends readonly[number,0]?TextDescriptor<{},${JSON.stringify(output.catalog.manifest.catalogId)},P>:X extends readonly[number,1,infer V extends object,infer G extends string]?RichDescriptor<V,G,${JSON.stringify(output.catalog.manifest.catalogId)},P>:X extends readonly[number,2,infer V extends object,infer R]?ValueDescriptor<V,R,${JSON.stringify(output.catalog.manifest.catalogId)},P>:never;`,
    'type _T<N,P extends string="">={readonly[K in keyof N]:N[K] extends _L?_D<N[K],_J<P,K&string>>:_T<N[K],_J<P,K&string>>};',
    `type _S=${schema};`,
    "",
    "export type CatalogContract=_T<_S>;",
    "",
  ].join("\n");
}

function typePropertyAccess(
  base: string,
  parts: ReadonlyArray<string>
): string {
  return `${base}${parts.map((part) => `[${JSON.stringify(part)}]`).join("")}`;
}

function catalogContractAccess(path: string): string {
  return typePropertyAccess("CatalogContract", path.split("."));
}

function emitDescriptorDeclaration(
  output: CompileOutput,
  root: ReadonlyArray<[string, TreeNode]>,
  compact: boolean
): string {
  const groups = compact
    ? compactDeclarationGroups(output.catalog.messages).map((group, index) => ({
        ...group,
        name: compactTypeName(index),
      }))
    : [];
  const groupByMessage = new Map<number, (typeof groups)[number]>();
  for (const group of groups) {
    for (const index of group.messageIndices) {
      groupByMessage.set(index, group);
    }
  }
  const messageDeclarations = output.catalog.messages.map((message, index) => {
    if (!compact) {
      return `export declare const ${runtimeMessageExportName(message.path, index, false)}: RuntimeMessage;\nexport declare const ${messageExportName(message.path, index, false)}: ${catalogContractAccess(message.path)};`;
    }
    const group = groupByMessage.get(index);
    if (!group) {
      throw new Error(`Compact declaration group is missing message ${index}`);
    }
    const suffix = message.path.split(".").slice(group.prefix.length);
    return `r${index}:RuntimeMessage,m${index}:${typePropertyAccess(group.name, suffix)}`;
  });
  const namespaceDeclarations = root.map(
    ([key]) =>
      `export declare const ${namespaceExportName(key)}:CatalogContract[${JSON.stringify(key)}];`
  );
  return [
    'import type { CatalogManifest, RuntimeMessage } from "@openmirai/intl-abi";',
    'import type { CatalogContract } from "./catalog.schema.gen.js";',
    "",
    'export type { CatalogContract } from "./catalog.schema.gen.js";',
    ...groups.map(
      (group) =>
        `type ${group.name}=${typePropertyAccess("CatalogContract", group.prefix)};`
    ),
    "export declare const catalogManifest:CatalogManifest;",
    ...(compact && messageDeclarations.length > 0
      ? [`export declare const ${messageDeclarations.join(",")};`]
      : messageDeclarations),
    ...namespaceDeclarations,
    "export declare const catalogTree:CatalogContract;",
    "",
  ].join("\n");
}

function emitContractDeclaration(
  output: CompileOutput,
  tree: TreeNode,
  compact: boolean
): string {
  if (compact) {
    return emitCompactContractDeclaration(output, tree);
  }
  return [
    'import type { RichDescriptor, TextDescriptor, ValueDescriptor } from "@openmirai/intl-abi";',
    "",
    `export type CatalogContract = ${emitTypeTree(tree, output.catalog.messages, output.catalog.manifest.catalogId, "")};`,
    "",
  ].join("\n");
}

function setResourceValue(
  root: JsonObject,
  path: string,
  value: JsonObject[string]
): void {
  const parts = path.split(".");
  let current = root;
  for (const [index, part] of parts.entries()) {
    if (index === parts.length - 1) {
      current[part] = value;
      return;
    }
    const existing = current[part];
    if (
      existing !== null &&
      typeof existing === "object" &&
      !Array.isArray(existing)
    ) {
      current = existing;
      continue;
    }
    const child: JsonObject = {};
    current[part] = child;
    current = child;
  }
}

function catalogResource(output: CompileOutput, locale: string): JsonObject {
  const translation: JsonObject = {};
  for (const message of output.composition.messages) {
    const value = message.translations[locale];
    if (value === undefined) {
      throw new Error(`${message.path} is missing locale ${locale}`);
    }
    setResourceValue(translation, message.path, value);
  }
  return { translation };
}

function resourceModuleName(index: number): string {
  return `catalog.resource.${index}.gen.mjs`;
}

function emitResourceLoaderModule(output: CompileOutput): string {
  const entries = output.catalog.manifest.locales.map(
    (locale, index) =>
      `  [${JSON.stringify(locale)}, () => import(${JSON.stringify(`./${resourceModuleName(index)}`)}).then(({ catalogResource }) => catalogResource)],`
  );
  return [
    "const catalogResourceLoaders = new Map([",
    ...entries,
    "]);",
    "",
    "export function isCatalogLocale(locale) {",
    '  return typeof locale === "string" && catalogResourceLoaders.has(locale);',
    "}",
    "",
    "export async function loadCatalogResource(locale) {",
    "  if (!isCatalogLocale(locale)) {",
    '    throw new RangeError(`Unknown catalog locale ${typeof locale === "string" ? JSON.stringify(locale) : typeof locale}`);',
    "  }",
    "  const load = catalogResourceLoaders.get(locale);",
    "  if (!load) {",
    "    throw new RangeError(`Unknown catalog locale ${JSON.stringify(locale)}`);",
    "  }",
    "  return load();",
    "}",
    "",
  ].join("\n");
}

function emitResourceLoaderDeclaration(output: CompileOutput): string {
  const locales = output.catalog.manifest.locales
    .map((locale) => JSON.stringify(locale))
    .join(" | ");
  return [
    'import type { JsonObject } from "@openmirai/intl-abi";',
    "",
    `export type CatalogLocale=${locales || "never"};`,
    "export type CatalogResource=Readonly<{readonly translation:JsonObject}>;",
    "export declare function isCatalogLocale(locale:unknown):locale is CatalogLocale;",
    "export declare function loadCatalogResource(locale:string):Promise<CatalogResource>;",
    "",
  ].join("\n");
}

function emitManifestDeclaration(output: CompileOutput): string {
  const locales = `readonly [${output.catalog.manifest.locales
    .map((locale) => JSON.stringify(locale))
    .join(",")}]`;
  return [
    'import type { TypedCatalogManifest } from "@openmirai/intl-runtime";',
    'import type { CatalogContract } from "./catalog.schema.gen.js";',
    "",
    `export declare const catalogManifest:TypedCatalogManifest<CatalogContract,${locales},${JSON.stringify(output.catalog.manifest.sourceLocale)}>;`,
    "",
  ].join("\n");
}

export function emitArtifacts(
  output: CompileOutput,
  representation: DescriptorRepresentation
): LegacyEmittedArtifacts;
export function emitArtifacts(
  output: CompileOutput,
  representation: DescriptorRepresentation,
  options: Readonly<{ compact: true }>
): EmittedArtifacts;
export function emitArtifacts(
  output: CompileOutput,
  representation: DescriptorRepresentation,
  options: EmitOptions
): EmittedArtifacts;
export function emitArtifacts(
  output: CompileOutput,
  representation: DescriptorRepresentation,
  options: EmitOptions = {}
): EmittedArtifacts {
  const tree = createTree(output.catalog.messages);
  const root = rootEntries(tree);
  const compact = options.compact === true;
  const contractDeclaration = emitContractDeclaration(output, tree, compact);
  const compactExports: ReadonlyArray<CompactExport> | undefined = compact
    ? output.catalog.messages.map((message, index) => ({
        descriptorExport: messageExportName(message.path, index, true),
        module: privateMessagesModuleName,
        path: message.path,
        runtimeExport: runtimeMessageExportName(message.path, index, true),
      }))
    : undefined;
  const artifacts: Record<string, string> = {
    "catalog.contract.gen.json": `${canonicalJson({
      catalogId: output.catalog.manifest.catalogId,
      messages: output.catalog.messages.map((message) => ({
        argumentSchema: message.argumentSchema,
        formatterIds: message.formatterIds,
        kind: message.kind,
        path: message.path,
        resultSchema: message.resultSchema,
        tags: message.tags,
      })),
      schemaVersion: 1,
    })}\n`,
    "catalog.manifest.gen.d.mts": emitManifestDeclaration(output),
    "catalog.manifest.gen.mjs": `export const catalogManifest = ${canonicalJson(output.catalog.manifest)};\n`,
    "catalog.provenance.gen.json": `${canonicalJson({
      catalogHash: output.catalog.manifest.hash,
      entries: output.composition.provenance,
      ...(compactExports
        ? {
            exports: compactExports,
          }
        : {}),
    })}\n`,
    "catalog.resources.gen.d.mts": emitResourceLoaderDeclaration(output),
    "catalog.resources.gen.mjs": emitResourceLoaderModule(output),
    "catalog.runtime.gen.json": `${canonicalJson(output.catalog)}\n`,
    "catalog.schema.gen.d.ts": contractDeclaration,
  };
  output.catalog.manifest.locales.forEach((locale, index) => {
    artifacts[resourceModuleName(index)] =
      `export const catalogResource = ${canonicalJson(catalogResource(output, locale))};\n`;
  });
  if (compact) {
    artifacts[privateMessagesModuleName] = emitPrivateMessagesModule(
      output,
      representation
    );
  } else {
    artifacts["catalog.descriptors.gen.d.mts"] = emitDescriptorDeclaration(
      output,
      root,
      false
    );
    artifacts["catalog.descriptors.gen.mjs"] = emitDescriptorModule(
      output,
      representation,
      false
    );
  }
  return Object.fromEntries(
    Object.entries(artifacts).toSorted(([left], [right]) =>
      compareCanonicalStrings(left, right)
    )
  ) as EmittedArtifacts;
}
