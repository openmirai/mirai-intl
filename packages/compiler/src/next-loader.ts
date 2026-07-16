import { ensureMiraiIntlCatalogOnce } from "./lifecycle";
import {
  authorizePrivateMessageSliceRequest,
  loadPrivateMessageSlice,
  parsePrivateMessageSliceRequest,
} from "./private-module";
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
  resourceQuery?: string;
}>;

/* oxlint-disable oxc/no-this-in-exported-function -- Webpack loaders receive their context through this. */
export default function miraiIntlNextLoader(
  this: LoaderContext,
  source: string,
  inputMap?: object
): void {
  this.cacheable?.(true);
  const callback = this.async();
  const resourceId = `${this.resourcePath}${this.resourceQuery ?? ""}`;
  const slice = parsePrivateMessageSliceRequest(resourceId);
  if (slice) {
    const options = this.getOptions();
    authorizePrivateMessageSliceRequest(resourceId, options).then(
      (authorized) => {
        if (!authorized) {
          callback(new Error("Private message slice authorization was lost"));
          return;
        }
        this.addDependency(authorized.currentFile);
        this.addDependency(authorized.messageFile);
        loadPrivateMessageSlice(authorized).then(
          (code) => callback(null, code, inputMap),
          (error: unknown) => {
            callback(error instanceof Error ? error : new Error(String(error)));
          }
        );
      },
      (error: unknown) => {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    );
    return;
  }
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
