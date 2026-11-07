/**
 * Free, app-pinned update authenticity (no paid certificate needed).
 *
 * Every release installer is signed by the release workflow with an Ed25519 key that
 * exists only as a secret of the protected `desktop-production` GitHub environment.
 * The installed app carries the matching public key and refuses any downloaded update
 * whose signature does not verify. The signed message binds the product, the version,
 * the installer file name and its SHA-512, so an older signed installer cannot be
 * replayed as a newer version and a modified file cannot pass.
 *
 * (Windows Authenticode is separate: it only removes the SmartScreen warning on a first,
 * manual install. When present, it is verified in addition to this signature.)
 *
 * Pure Node: no Electron imports, unit-tested directly.
 */
import { createHash, createPublicKey, sign, verify } from "node:crypto";
import { createReadStream } from "node:fs";
import { basename } from "node:path";

/** Public half of the desktop update-signing key (private half: GitHub environment secret). */
export const UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEABiOOwZRi9+fKR0Qbr9+6V9IiuQdN7nbXR/BZY476YfM=
-----END PUBLIC KEY-----
`;

export const SIGNATURE_SUFFIX = ".sig";

export type UpdateSignature = {
  format: "inkstrip-update-signature";
  version: 1;
  product: "inkstrip-manhwa-studio-desktop";
  appVersion: string;
  file: string;
  sha512: string;
  signature: string;
};

export function signedMessage(appVersion: string, file: string, sha512: string) {
  return Buffer.from(`inkstrip-manhwa-studio-desktop\n${appVersion}\n${file}\n${sha512}\n`, "utf8");
}

export function sha512File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha512");
    createReadStream(path, { highWaterMark: 4 * 1024 * 1024 })
      .on("data", (d) => hash.update(d))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/** Release side: create the `.sig` document for an installer. */
export async function signInstaller(path: string, appVersion: string, privateKeyPem: string): Promise<UpdateSignature> {
  const sha512 = await sha512File(path);
  const file = basename(path);
  const signature = sign(null, signedMessage(appVersion, file, sha512), privateKeyPem).toString("base64");
  return { format: "inkstrip-update-signature", version: 1, product: "inkstrip-manhwa-studio-desktop", appVersion, file, sha512, signature };
}

export class UpdateSignatureError extends Error {}

/**
 * App side: verify a downloaded installer against its `.sig` document, the version the
 * app expects to install, and the pinned public key. Throws UpdateSignatureError.
 */
export async function verifyInstaller(
  path: string,
  signatureJson: unknown,
  expected: { appVersion: string; file: string },
  publicKeyPem: string = UPDATE_PUBLIC_KEY,
) {
  const s = signatureJson as Partial<UpdateSignature>;
  if (
    !s ||
    s.format !== "inkstrip-update-signature" ||
    s.version !== 1 ||
    s.product !== "inkstrip-manhwa-studio-desktop" ||
    typeof s.signature !== "string" ||
    typeof s.sha512 !== "string"
  )
    throw new UpdateSignatureError("The update signature is missing or malformed.");
  if (s.appVersion !== expected.appVersion || s.file !== expected.file)
    throw new UpdateSignatureError("The update signature belongs to a different version or file.");
  const actual = await sha512File(path);
  if (actual !== s.sha512) throw new UpdateSignatureError("The downloaded update does not match its signature.");
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== "ed25519") throw new UpdateSignatureError("Unexpected update key type.");
  const ok = verify(null, signedMessage(expected.appVersion, expected.file, actual), key, Buffer.from(s.signature, "base64"));
  if (!ok) throw new UpdateSignatureError("The update signature is not from the Inkstrip release key.");
  return true;
}
