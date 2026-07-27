import type { EmittedArtifacts } from "../src/emit";
import {
  verifyArtifactSet as verifyAuthoritativeArtifactSet,
  writeArtifactSet as writeAuthoritativeArtifactSet,
} from "../src/writer";
import type {
  ArtifactWriterOptions,
  StableFacadeOptions,
  WriteResult,
} from "../src/writer";

const emptyFacade: StableFacadeOptions = Object.freeze({ exports: [] });

function testOptions(
  options: ArtifactWriterOptions | undefined
): ArtifactWriterOptions {
  return options?.generationInput
    ? options
    : { ...options, authority: "non-authoritative-test-only" };
}

export function writeArtifactSet(
  root: string,
  artifacts: EmittedArtifacts,
  facade: StableFacadeOptions = emptyFacade,
  options?: ArtifactWriterOptions
): Promise<WriteResult> {
  return writeAuthoritativeArtifactSet(
    root,
    artifacts,
    facade,
    testOptions(options)
  );
}

export function verifyArtifactSet(
  root: string,
  artifacts: EmittedArtifacts,
  facade: StableFacadeOptions = emptyFacade,
  options?: ArtifactWriterOptions
): Promise<WriteResult> {
  return verifyAuthoritativeArtifactSet(
    root,
    artifacts,
    facade,
    testOptions(options)
  );
}
