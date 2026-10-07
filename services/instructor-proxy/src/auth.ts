import { Header } from "./http.ts";

const BEARER_PREFIX = "Bearer ";
const HASH_ALGORITHM = "SHA-256";
const HASH_BYTES = 32;

export async function authorized(request: Request, secret: string): Promise<boolean> {
  const header = request.headers.get(Header.authorization) ?? "";
  const bearer = header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : "";
  const encoder = new TextEncoder();
  // Hash both UTF-8 values so comparison has fixed cost even when their lengths differ.
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest(HASH_ALGORITHM, encoder.encode(bearer)),
    crypto.subtle.digest(HASH_ALGORITHM, encoder.encode(secret)),
  ]);
  const actualBytes = new Uint8Array(actual);
  const expectedBytes = new Uint8Array(expected);
  let difference = 0;
  for (let index = 0; index < HASH_BYTES; index++) difference |= actualBytes[index] ^ expectedBytes[index];
  return difference === 0 && secret.length > 0 && header.startsWith(BEARER_PREFIX);
}

