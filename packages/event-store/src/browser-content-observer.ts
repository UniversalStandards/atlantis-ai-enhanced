import {
  admitUntrustedBrowserContent,
  type AdmittedUntrustedBrowserContent,
  type BrowserContentKind,
  type UntrustedBrowserContentObservation,
} from "./untrusted-browser-content.js";

export interface BrowserContentObservationRequest {
  readonly sourceUrl: string;
  readonly kind: BrowserContentKind;
}

/**
 * Provider-neutral browser/session seam. Concrete browser drivers implement only
 * observation; page content never carries approval, identity, mutation, or
 * credential authority across this interface.
 */
export interface BrowserContentObservationPort {
  observe(request: Readonly<BrowserContentObservationRequest>): Promise<Readonly<UntrustedBrowserContentObservation>>;
}

export class BrowserContentObserver {
  public constructor(private readonly port: BrowserContentObservationPort) {}

  public async observe(
    request: Readonly<BrowserContentObservationRequest>,
  ): Promise<Readonly<AdmittedUntrustedBrowserContent>> {
    const observed = await this.port.observe(Object.freeze({
      sourceUrl: request.sourceUrl,
      kind: request.kind,
    }));

    const admitted = admitUntrustedBrowserContent(observed);
    if (admitted.sourceUrl !== request.sourceUrl || admitted.kind !== request.kind) {
      throw new Error("browser observation does not match the requested source and content kind.");
    }
    return admitted;
  }
}
