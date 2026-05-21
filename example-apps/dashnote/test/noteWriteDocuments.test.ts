// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import {
  ENCRYPTED_NOTE_PREFIX,
  ENCRYPTED_NOTE_TITLE,
} from "../src/lib/encryptedNotes";
import {
  buildCreateNoteDocument,
  buildReplaceNoteDocument,
  documentId,
} from "../src/lib/noteWriteDocuments";

const keyMaterial = {
  keyId: 4,
  keyVersion: 1,
  privateKeyBytes: new Uint8Array(32).fill(7),
};

const constructed: unknown[] = [];

class MockDocument {
  args: unknown;
  id?: string;
  entropy?: Uint8Array | number[];

  constructor(args: unknown) {
    this.args = args;
    const typed = args as { id?: string; entropy?: Uint8Array | number[] };
    this.id = typed.id ?? "generated-note-id";
    this.entropy = typed.entropy ?? new Uint8Array(32).fill(1);
    constructed.push(this);
  }

  toJSON() {
    return { $id: this.id };
  }
}

beforeEach(() => {
  constructed.length = 0;
});

describe("buildCreateNoteDocument", () => {
  it("builds a plain create document with trimmed note fields", async () => {
    const document = await buildCreateNoteDocument({
      Document: MockDocument,
      contractId: "contract-1",
      ownerId: "identity-1",
      title: "  Hello  ",
      message: "Body",
    });

    expect(document).toBe(constructed[0]);
    expect((constructed[0] as MockDocument).args).toEqual({
      properties: {
        title: "Hello",
        message: "Body",
      },
      documentTypeName: "note",
      dataContractId: "contract-1",
      ownerId: "identity-1",
    });
  });

  it("builds an encrypted create document using the SDK-generated id and entropy", async () => {
    const document = await buildCreateNoteDocument({
      Document: MockDocument,
      contractId: "contract-1",
      ownerId: "identity-1",
      title: "Private title",
      message: "Private body",
      encryption: {
        network: "testnet",
        keyMaterial,
      },
    });

    expect(document).toBe(constructed[1]);
    expect(constructed).toHaveLength(2);
    const finalArgs = (constructed[1] as MockDocument).args as {
      id: string;
      entropy: Uint8Array;
      properties: { title: string; message: string };
    };
    expect(finalArgs.id).toBe("generated-note-id");
    expect(finalArgs.entropy).toEqual(new Uint8Array(32).fill(1));
    expect(finalArgs.properties.title).toBe(ENCRYPTED_NOTE_TITLE);
    expect(finalArgs.properties.message).toMatch(
      new RegExp(`^${ENCRYPTED_NOTE_PREFIX}`),
    );
    expect(finalArgs.properties.message).not.toContain("Private title");
    expect(finalArgs.properties.message).not.toContain("Private body");
  });

  it("fails closed when encrypted create cannot read SDK document id", async () => {
    class NoIdDocument extends MockDocument {
      constructor(args: unknown) {
        super(args);
        this.id = undefined;
      }

      toJSON() {
        return {};
      }
    }

    await expect(
      buildCreateNoteDocument({
        Document: NoIdDocument,
        contractId: "contract-1",
        ownerId: "identity-1",
        title: "Private title",
        message: "Private body",
        encryption: {
          network: "testnet",
          keyMaterial,
        },
      }),
    ).rejects.toThrow(/document\.id before submit/i);
  });

  it("fails closed when encrypted create cannot read SDK document entropy", async () => {
    class NoEntropyDocument extends MockDocument {
      constructor(args: unknown) {
        super(args);
        this.entropy = undefined;
      }
    }

    await expect(
      buildCreateNoteDocument({
        Document: NoEntropyDocument,
        contractId: "contract-1",
        ownerId: "identity-1",
        title: "Private title",
        message: "Private body",
        encryption: {
          network: "testnet",
          keyMaterial,
        },
      }),
    ).rejects.toThrow(/document entropy before submit/i);
  });
});

describe("buildReplaceNoteDocument", () => {
  it("builds a plain replace document with the caller revision", async () => {
    await buildReplaceNoteDocument({
      Document: MockDocument,
      contractId: "contract-1",
      ownerId: "identity-1",
      noteId: "note-9",
      revision: 5n,
      title: "",
      message: "Updated body",
    });

    expect((constructed[0] as MockDocument).args).toEqual({
      properties: {
        message: "Updated body",
      },
      documentTypeName: "note",
      dataContractId: "contract-1",
      ownerId: "identity-1",
      revision: 5n,
      id: "note-9",
    });
  });

  it("builds an encrypted replace document without plaintext fields", async () => {
    await buildReplaceNoteDocument({
      Document: MockDocument,
      contractId: "contract-1",
      ownerId: "identity-1",
      noteId: "note-9",
      revision: 5n,
      title: "Private title",
      message: "Private body",
      encryption: {
        network: "testnet",
        keyMaterial,
      },
    });

    const finalArgs = (constructed[0] as MockDocument).args as {
      properties: { title: string; message: string };
    };
    expect(finalArgs.properties.title).toBe(ENCRYPTED_NOTE_TITLE);
    expect(finalArgs.properties.message).toMatch(
      new RegExp(`^${ENCRYPTED_NOTE_PREFIX}`),
    );
    expect(finalArgs.properties.message).not.toContain("Private title");
    expect(finalArgs.properties.message).not.toContain("Private body");
  });
});

describe("documentId", () => {
  it("prefers direct id and falls back to serialized ids", () => {
    expect(documentId({ id: "direct", toJSON: () => ({ $id: "json" }) })).toBe(
      "direct",
    );
    expect(documentId({ toJSON: () => ({ $id: "json-id" }) })).toBe("json-id");
    expect(documentId({ toJSON: () => ({ id: "plain-json-id" }) })).toBe(
      "plain-json-id",
    );
    expect(documentId({})).toBe("");
  });
});
