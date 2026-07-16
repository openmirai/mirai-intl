import { ensureMiraiIntlCatalogOnce } from "./lifecycle";
import {
  isMiraiIntlTransformCandidate,
  transformMiraiIntlSource,
} from "./transform";
import type {
  MiraiIntlSourceMap,
  MiraiIntlTransformOptions,
} from "./transform";

type LoaderCallback = (
  error: Error | null,
  code?: string,
  map?: MiraiIntlSourceMap | object
) => void;

type LoaderContext = Readonly<{
  addDependency(path: string): void;
  async(): LoaderCallback;
  cacheable?(cacheable?: boolean): void;
  getOptions(): MiraiIntlTransformOptions;
  resourcePath: string;
}>;

/* oxlint-disable oxc/no-this-in-exported-function -- Webpack loaders receive their context through this. */
export default function miraiIntlNextLoader(
  this: LoaderContext,
  source: string,
  inputMap?: object
): void {
  this.cacheable?.(true);
  const callback = this.async();
  if (!isMiraiIntlTransformCandidate(source, this.resourcePath)) {
    callback(null, source, inputMap);
    return;
  }
  const options = this.getOptions();
  ensureMiraiIntlCatalogOnce(options)
    .then(() => transformMiraiIntlSource(source, this.resourcePath, options))
    .then(
      (result) => {
        if (!result) {
          callback(null, source, inputMap);
          return;
        }
        for (const dependency of result.dependencies) {
          this.addDependency(dependency);
        }
        callback(null, result.code, result.map);
      },
      (error: unknown) => {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    );
}
/* oxlint-enable oxc/no-this-in-exported-function */
