import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";

const PREFIX = "enc:v1:";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function parseKey(rawKey = process.env.TOKEN_ENCRYPTION_KEY || "") {
  const value = String(rawKey).trim();

  if (!value) return null;

  if (/^[a-f0-9]{64}$/i.test(value)) {
    return Buffer.from(value, "hex");
  }

  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 32) return decoded;

  throw new Error(
    "TOKEN_ENCRYPTION_KEY must be a 32-byte base64 value or 64-character hex value"
  );
}

function encode(buffer) {
  return buffer.toString("base64url");
}

function decode(value) {
  return Buffer.from(value, "base64url");
}

export function isEncryptedSecret(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function tokenEncryptionConfigured() {
  return Boolean(parseKey());
}

export function encryptSecret(value, { key } = {}) {
  if (value === null || value === undefined || value === "") return value || null;
  if (isEncryptedSecret(value)) return value;

  const encryptionKey = parseKey(key);

  if (!encryptionKey) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is required before provider credentials can be stored"
    );
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(value), "utf8"),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return `${PREFIX}${encode(iv)}.${encode(authTag)}.${encode(ciphertext)}`;
}

export function decryptSecret(value, { key } = {}) {
  if (value === null || value === undefined || value === "") return value || null;
  if (!isEncryptedSecret(value)) return String(value);

  const encryptionKey = parseKey(key);
  if (!encryptionKey) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is required to decrypt stored provider credentials"
    );
  }

  const payload = value.slice(PREFIX.length);
  const [ivValue, tagValue, ciphertextValue, ...extra] = payload.split(".");

  if (!ivValue || !tagValue || !ciphertextValue || extra.length) {
    throw new Error("Encrypted provider credential has an invalid format");
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, encryptionKey, decode(ivValue));
    decipher.setAuthTag(decode(tagValue));

    return Buffer.concat([
      decipher.update(decode(ciphertextValue)),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new Error("Unable to decrypt provider credential");
  }
}

export function hashRateLimitKey(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function encryptTokenFields(fields = {}) {
  const next = { ...fields };

  if (Object.prototype.hasOwnProperty.call(next, "access_token")) {
    next.access_token = encryptSecret(next.access_token);
  }

  if (Object.prototype.hasOwnProperty.call(next, "refresh_token")) {
    next.refresh_token = encryptSecret(next.refresh_token);
  }

  return next;
}

export function decryptConnectionTokens(connection) {
  if (!connection) return connection;

  return {
    ...connection,
    access_token: decryptSecret(connection.access_token),
    refresh_token: decryptSecret(connection.refresh_token)
  };
}

export const TOKEN_ENCRYPTION_PREFIX = PREFIX;
