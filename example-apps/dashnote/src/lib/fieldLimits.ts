export const FIELD_BYTE_LIMIT = 5120;

const encoder = new TextEncoder();

export function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export function isOversize(value: string): boolean {
  return byteLength(value) > FIELD_BYTE_LIMIT;
}

export interface FieldBudget {
  used: number;
  remaining: number;
  over: boolean;
  ratio: number;
}

export function fieldBudget(used: number): FieldBudget {
  const remaining = FIELD_BYTE_LIMIT - used;
  return {
    used,
    remaining,
    over: remaining < 0,
    ratio: Math.min(1.5, Math.max(0, used / FIELD_BYTE_LIMIT)),
  };
}
