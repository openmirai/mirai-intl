import { SeverityNumber } from "@opentelemetry/api-logs";
import type { IntlDiagnostic } from "@openmirai/intl-abi";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createOtelDiagnosticSink } from "../src/otel";

const emit = vi.fn();
const getLogger = vi.fn(() => ({ emit }));

vi.mock("@opentelemetry/api-logs", () => ({
  SeverityNumber: {
    WARN: 13,
  },
  logs: {
    getLogger,
  },
}));

const missingResource = (
  overrides: Partial<IntlDiagnostic> = {}
): IntlDiagnostic => ({
  code: "INTL_MISSING_RESOURCE",
  locale: "en",
  message: "Missing resource",
  path: "pages.home.title",
  ...overrides,
});

describe("createOtelDiagnosticSink", () => {
  afterEach(() => {
    emit.mockReset();
    getLogger.mockClear();
    getLogger.mockImplementation(() => ({ emit }));
  });

  it("emits a WARN log for INTL_MISSING_RESOURCE", () => {
    const sink = createOtelDiagnosticSink({
      loggerName: "openmirai.test.i18n",
    });

    sink(missingResource());

    expect(getLogger).toHaveBeenCalledWith("openmirai.test.i18n");
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({
      attributes: {
        "i18n.code": "INTL_MISSING_RESOURCE",
        "i18n.key": "pages.home.title",
        "i18n.locale": "en",
        "i18n.namespace": "pages",
      },
      body: "Missing translation",
      severityNumber: SeverityNumber.WARN,
      severityText: "WARN",
    });
  });

  it("dedupes repeated diagnostics", () => {
    const sink = createOtelDiagnosticSink();
    const diagnostic = missingResource();

    sink(diagnostic);
    sink(diagnostic);

    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("ignores codes outside the configured allow-list", () => {
    const sink = createOtelDiagnosticSink();

    sink({
      code: "INTL_ABI_MISMATCH",
      message: "ABI mismatch",
    });

    expect(emit).not.toHaveBeenCalled();
  });

  it("fail-opens when getLogger throws", () => {
    getLogger.mockImplementation(() => {
      throw new Error("provider unavailable");
    });

    const sink = createOtelDiagnosticSink();

    expect(() => sink(missingResource())).not.toThrow();
    expect(emit).not.toHaveBeenCalled();
  });

  it("fail-opens when emit throws", () => {
    emit.mockImplementation(() => {
      throw new Error("exporter unavailable");
    });

    const sink = createOtelDiagnosticSink();

    expect(() => sink(missingResource())).not.toThrow();
  });

  it("uses translation namespace when path has no separator", () => {
    const sink = createOtelDiagnosticSink();

    sink(missingResource({ path: "greeting" }));

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.objectContaining({
          "i18n.key": "greeting",
          "i18n.namespace": "translation",
        }),
      })
    );
  });
});
