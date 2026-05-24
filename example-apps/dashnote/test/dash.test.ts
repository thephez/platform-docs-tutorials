// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDocumentConstructor, mockDocumentState } = vi.hoisted(() => ({
  mockDocumentConstructor: vi.fn(),
  mockDocumentState: {
    id: null as string | null,
    entropy: null as Uint8Array | number[] | null,
  },
}));

vi.mock("@dashevo/evo-sdk", () => ({
  Document: function MockDocument(args: unknown) {
    mockDocumentConstructor(args);
    const document: {
      args: unknown;
      id?: string;
      entropy?: Uint8Array | number[];
      toJSON: () => { $id: string };
    } = {
      args,
      toJSON: () => ({ $id: mockDocumentState.id ?? "note-1" }),
    };
    if (mockDocumentState.id) document.id = mockDocumentState.id;
    if (mockDocumentState.entropy) document.entropy = mockDocumentState.entropy;
    return document;
  },
}));

import { createNote } from "../src/dash/createNote";
import { deleteNote } from "../src/dash/deleteNote";
import { updateNote } from "../src/dash/updateNote";
import {
  ENCRYPTED_NOTE_PREFIX,
  ENCRYPTED_NOTE_TITLE,
} from "../src/lib/encryptedNotes";

function makeKeyManager() {
  return {
    getAuth: vi.fn().mockResolvedValue({
      identity: { id: "identity-1" },
      identityKey: "identity-key",
      signer: "signer",
    }),
  };
}

const keyMaterial = {
  keyId: 4,
  keyVersion: 1,
  privateKeyBytes: new Uint8Array(32).fill(7),
};

beforeEach(() => {
  mockDocumentConstructor.mockReset();
  mockDocumentState.id = null;
  mockDocumentState.entropy = null;
});

describe("createNote", () => {
  it("creates a note with a trimmed title", async () => {
    const sdk = {
      documents: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };

    const noteId = await createNote({
      sdk: sdk as never,
      keyManager: makeKeyManager() as never,
      contractId: "contract-1",
      title: "  Hello  ",
      message: "Body",
    });

    expect(noteId).toBe("note-1");
    expect(mockDocumentConstructor).toHaveBeenCalledWith({
      properties: {
        title: "Hello",
        message: "Body",
      },
      documentTypeName: "note",
      dataContractId: "contract-1",
      ownerId: "identity-1",
    });
  });

  it("omits a blank title for body-only notes", async () => {
    mockDocumentConstructor.mockReset();
    const sdk = {
      documents: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };

    await createNote({
      sdk: sdk as never,
      keyManager: makeKeyManager() as never,
      contractId: "contract-1",
      title: "   ",
      message: "Body only",
    });

    expect(mockDocumentConstructor).toHaveBeenCalledWith({
      properties: {
        message: "Body only",
      },
      documentTypeName: "note",
      dataContractId: "contract-1",
      ownerId: "identity-1",
    });
  });

  it("fails closed for encrypted creation when document.id is unavailable before submit", async () => {
    const sdk = {
      documents: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };

    await expect(
      createNote({
        sdk: sdk as never,
        keyManager: makeKeyManager() as never,
        contractId: "contract-1",
        title: "Secret",
        message: "Body",
        encryption: {
          network: "testnet",
          keyMaterial,
        },
      }),
    ).rejects.toThrow(/document\.id before submit/i);
    expect(sdk.documents.create).not.toHaveBeenCalled();
  });

  it("submits only encrypted envelope fields when encryption is enabled", async () => {
    mockDocumentState.id = "note-created";
    mockDocumentState.entropy = new Uint8Array(32).fill(1);
    const sdk = {
      documents: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };

    const noteId = await createNote({
      sdk: sdk as never,
      keyManager: makeKeyManager() as never,
      contractId: "contract-1",
      title: "  Secret title  ",
      message: "Secret body",
      encryption: {
        network: "testnet",
        keyMaterial,
      },
    });

    expect(noteId).toBe("note-created");
    expect(mockDocumentConstructor).toHaveBeenCalledTimes(2);
    const finalArgs = mockDocumentConstructor.mock.calls[1][0] as {
      properties: { title: string; message: string };
      id: string;
      entropy: Uint8Array;
    };
    expect(finalArgs.id).toBe("note-created");
    expect(finalArgs.properties.title).toBe(ENCRYPTED_NOTE_TITLE);
    expect(finalArgs.properties.message).toMatch(
      new RegExp(`^${ENCRYPTED_NOTE_PREFIX}`),
    );
    expect(finalArgs.properties.message).not.toContain("Secret title");
    expect(finalArgs.properties.message).not.toContain("Secret body");
    expect(sdk.documents.create).toHaveBeenCalledWith({
      document: expect.objectContaining({ args: finalArgs }),
      identityKey: "identity-key",
      signer: "signer",
    });
  });
});

describe("updateNote", () => {
  it("fetches the current note and increments revision before replace", async () => {
    const sdk = {
      documents: {
        get: vi.fn().mockResolvedValue({ revision: 4n }),
        replace: vi.fn().mockResolvedValue(undefined),
      },
    };

    await updateNote({
      sdk: sdk as never,
      keyManager: makeKeyManager() as never,
      contractId: "contract-1",
      noteId: "note-9",
      title: "",
      message: "Updated body",
    });

    expect(sdk.documents.get).toHaveBeenCalledWith(
      "contract-1",
      "note",
      "note-9",
    );
    expect(mockDocumentConstructor).toHaveBeenCalledWith({
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

  it("replaces with only encrypted envelope fields when encryption is enabled", async () => {
    const sdk = {
      documents: {
        get: vi.fn().mockResolvedValue({ revision: 4n }),
        replace: vi.fn().mockResolvedValue(undefined),
      },
    };

    await updateNote({
      sdk: sdk as never,
      keyManager: makeKeyManager() as never,
      contractId: "contract-1",
      noteId: "note-9",
      title: "Secret title",
      message: "Secret body",
      encryption: {
        network: "testnet",
        keyMaterial,
      },
    });

    const finalArgs = mockDocumentConstructor.mock.calls[0][0] as {
      properties: { title: string; message: string };
      id: string;
      revision: bigint;
    };
    expect(finalArgs.id).toBe("note-9");
    expect(finalArgs.revision).toBe(5n);
    expect(finalArgs.properties.title).toBe(ENCRYPTED_NOTE_TITLE);
    expect(finalArgs.properties.message).toMatch(
      new RegExp(`^${ENCRYPTED_NOTE_PREFIX}`),
    );
    expect(finalArgs.properties.message).not.toContain("Secret title");
    expect(finalArgs.properties.message).not.toContain("Secret body");
    expect(sdk.documents.replace).toHaveBeenCalledWith({
      document: expect.objectContaining({ args: finalArgs }),
      identityKey: "identity-key",
      signer: "signer",
    });
  });
});

describe("deleteNote", () => {
  it("passes the note identity fields to sdk.documents.delete", async () => {
    const sdk = {
      documents: {
        delete: vi.fn().mockResolvedValue(undefined),
      },
    };

    await deleteNote({
      sdk: sdk as never,
      keyManager: makeKeyManager() as never,
      contractId: "contract-1",
      noteId: "note-3",
    });

    expect(sdk.documents.delete).toHaveBeenCalledWith({
      document: {
        id: "note-3",
        ownerId: "identity-1",
        dataContractId: "contract-1",
        documentTypeName: "note",
      },
      identityKey: "identity-key",
      signer: "signer",
    });
  });
});
