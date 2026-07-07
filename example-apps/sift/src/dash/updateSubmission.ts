/**
 * Edit a submitter's own Sift submission.
 *
 * Every document mutation on Platform requires fetching the current on-chain
 * Document first and bumping its `revision` by exactly 1. Sift keeps history
 * enabled so review-context edits stay visible.
 *
 * SDK methods: sdk.documents.get(...), sdk.documents.replace(...)
 */
import { Document } from "@dashevo/evo-sdk";

import { errorMessage, type Logger } from "./logger";
import type { DashKeyManager, DashSdk } from "./types";
import type { SubmissionSeverity } from "./submitSubmission";

export interface UpdateSubmissionInput {
  title?: string;
  severity?: SubmissionSeverity;
  component?: string;
  description?: string;
}

export async function updateSubmission({
  sdk,
  keyManager,
  contractId,
  submissionId,
  updates,
  log,
}: {
  sdk: DashSdk;
  keyManager: DashKeyManager;
  contractId: string;
  submissionId: string;
  updates: UpdateSubmissionInput;
  log?: Logger;
}): Promise<void> {
  try {
    const { identityKey, signer } = await keyManager.getAuth();

    const existing = await sdk.documents.get(
      contractId,
      "submission",
      submissionId,
    );
    if (!existing) throw new Error(`Submission ${submissionId} not found.`);

    const properties: Record<string, unknown> = {
      title: updates.title?.trim() ?? existing.title,
      severity: updates.severity ?? existing.severity,
      component: updates.component?.trim() ?? existing.component,
      description: updates.description?.trim() ?? existing.description,
    };
    if (existing.pocHash) properties.pocHash = existing.pocHash;

    const revision = BigInt(existing.revision ?? 0) + 1n;
    const doc = new Document({
      properties,
      documentTypeName: "submission",
      dataContractId: contractId,
      ownerId: existing.$ownerId as string,
      id: submissionId,
      revision,
    });

    await sdk.documents.replace({ document: doc, identityKey, signer });
    log?.(`Submission ${submissionId} updated.`, "success");
  } catch (e) {
    log?.(`Update error: ${errorMessage(e)}`, "error");
    throw e;
  }
}
