/**
 * Read queries over the Sift contract's `submission` document type.
 *
 * normalizeSubmissions() hides the three possible shapes the SDK may return
 * (Array, Map, or plain object) so UI code always sees a plain array.
 *
 * SDK method: sdk.documents.query({ dataContractId, documentTypeName, where?, orderBy?, limit })
 */
import type { Logger } from "./logger.js";
import type {
  DashSdk,
  DashSubmissionQueryDocument,
  DashSubmissionQueryResults,
} from "./types";
import type { SubmissionSeverity } from "./submitSubmission";

const MAX_QUERY_LIMIT = 100;

export interface Submission {
  id: string;
  ownerId: string;
  revision: bigint | number | string;
  title: string;
  severity: SubmissionSeverity;
  component: string;
  description: string;
  pocHash?: string;
  createdAt?: bigint | number | string;
}

function toSubmission(
  id: string | null,
  raw: DashSubmissionQueryDocument,
): Submission {
  const j: Record<string, unknown> =
    typeof raw?.toJSON === "function" ? raw.toJSON() : raw;
  return {
    id: (id ?? (j.$id as string) ?? (j.id as string)) as string,
    ownerId: j.$ownerId as string,
    revision: (j.$revision as bigint | number | string) ?? 1n,
    title: j.title as string,
    severity: j.severity as SubmissionSeverity,
    component: j.component as string,
    description: j.description as string,
    pocHash: j.pocHash as string | undefined,
    createdAt: j.$createdAt as bigint | number | string | undefined,
  };
}

export function normalizeSubmissions(
  results: DashSubmissionQueryResults,
): Submission[] {
  if (Array.isArray(results)) return results.map((d) => toSubmission(null, d));
  const entries =
    results instanceof Map ? Object.fromEntries(results) : results;
  return Object.entries(entries).map(([id, d]) => toSubmission(id, d));
}

interface BaseParams {
  sdk: DashSdk;
  contractId: string;
  limit?: number;
  log?: Logger;
}

export async function listSubmissionsByOwner({
  sdk,
  contractId,
  ownerId,
  limit = MAX_QUERY_LIMIT,
  log,
}: BaseParams & { ownerId: string }): Promise<Submission[]> {
  log?.("Loading your submissions...");
  const results = await sdk.documents.query({
    dataContractId: contractId,
    documentTypeName: "submission",
    where: [["$ownerId", "==", ownerId]],
    orderBy: [
      ["$ownerId", "asc"],
      ["$createdAt", "desc"],
    ],
    limit,
  });
  const submissions = normalizeSubmissions(results);
  log?.(`Found ${submissions.length} submission(s).`);
  return submissions;
}

export async function listSubmissionsBySeverity({
  sdk,
  contractId,
  severity,
  limit = MAX_QUERY_LIMIT,
  log,
}: BaseParams & { severity: SubmissionSeverity }): Promise<Submission[]> {
  log?.(`Loading ${severity} submissions...`);
  const results = await sdk.documents.query({
    dataContractId: contractId,
    documentTypeName: "submission",
    where: [["severity", "==", severity]],
    orderBy: [
      ["severity", "asc"],
      ["$createdAt", "desc"],
    ],
    limit,
  });
  const submissions = normalizeSubmissions(results);
  log?.(`Found ${submissions.length} ${severity} submission(s).`);
  return submissions;
}

export async function listSubmissionsByComponent({
  sdk,
  contractId,
  component,
  limit = MAX_QUERY_LIMIT,
  log,
}: BaseParams & { component: string }): Promise<Submission[]> {
  log?.(`Loading submissions for "${component}"...`);
  const results = await sdk.documents.query({
    dataContractId: contractId,
    documentTypeName: "submission",
    where: [["component", "==", component]],
    orderBy: [
      ["component", "asc"],
      ["$createdAt", "desc"],
    ],
    limit,
  });
  const submissions = normalizeSubmissions(results);
  log?.(`Found ${submissions.length} submission(s) for "${component}".`);
  return submissions;
}

export async function listAllSubmissions({
  sdk,
  contractId,
  limit = MAX_QUERY_LIMIT,
  log,
}: BaseParams): Promise<Submission[]> {
  log?.("Loading all submissions...");
  const results = await sdk.documents.query({
    dataContractId: contractId,
    documentTypeName: "submission",
    limit,
  });
  const submissions = normalizeSubmissions(results);
  log?.(`Found ${submissions.length} submission(s) total.`);
  return submissions;
}

export async function findSubmissionById({
  sdk,
  contractId,
  submissionId,
  log,
}: {
  sdk: DashSdk;
  contractId: string;
  submissionId: string;
  log?: Logger;
}): Promise<Submission | undefined> {
  const doc = await sdk.documents.get(contractId, "submission", submissionId);
  if (!doc) {
    log?.(`Submission ${submissionId} not found.`);
    return undefined;
  }
  return toSubmission(submissionId, doc as DashSubmissionQueryDocument);
}
