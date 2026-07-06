/**
 * Submit to the Sift review queue.
 *
 * The `submission` document type costs 1 Sift token to create. That spend is
 * the PoC's anti-slop friction: queue access is scarce, visible, and governed
 * by panel-controlled suspend/restore/revoke actions.
 *
 * SDK method: sdk.documents.create({ document, identityKey, signer, tokenPaymentInfo })
 */
import { Document } from "@dashevo/evo-sdk";

import type { Logger } from "./logger";
import { SIFT_TOKEN_PAYMENT_INFO } from "./siftToken";
import type { DashKeyManager, DashSdk } from "./types";

export type SubmissionSeverity = "low" | "medium" | "high" | "critical";

export interface SubmitSubmissionInput {
  title: string;
  severity: SubmissionSeverity;
  component: string;
  description: string;
  /** Optional base64 SHA-256 of locally-hashed evidence. */
  pocHash?: string;
}

export interface SubmitSubmissionParams {
  sdk: DashSdk;
  keyManager: DashKeyManager;
  contractId: string;
  submission: SubmitSubmissionInput;
  log?: Logger;
}

export async function submitSubmission({
  sdk,
  keyManager,
  contractId,
  submission,
  log,
}: SubmitSubmissionParams): Promise<void> {
  const title = submission.title.trim();
  const component = submission.component.trim();
  const description = submission.description.trim();
  if (!title) throw new Error("Submission title is required.");
  if (!component) throw new Error("Affected component is required.");
  if (!description) throw new Error("Public summary is required.");

  log?.(`Spending 1 Sift token to submit "${title}"...`);

  const { identity, identityKey, signer } = await keyManager.getAuth();

  const properties: Record<string, unknown> = {
    title,
    severity: submission.severity,
    component,
    description,
  };
  if (submission.pocHash) properties.pocHash = submission.pocHash;

  const doc = new Document({
    properties,
    documentTypeName: "submission",
    dataContractId: contractId,
    ownerId: identity.id,
  });

  await sdk.documents.create({
    document: doc,
    identityKey,
    signer,
    tokenPaymentInfo: SIFT_TOKEN_PAYMENT_INFO,
  });
  log?.(`Submission "${title}" filed.`, "success");
}
