import { ulid } from "ulid";

export type IdPrefix =
  | "usr"
  | "dev"
  | "ses"
  | "hst"
  | "conn"
  | "aud"
  | "key"
  | "fam"
  | "inv"
  | "rst";

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid()}`;
}
