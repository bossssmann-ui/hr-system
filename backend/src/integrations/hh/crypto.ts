import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const VERSION = 'v1'

export function encryptHhSecret(plaintext: string, keyMaterial: string) {
  const key = normalizeKey(keyMaterial)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [VERSION, iv.toString('base64url'), authTag.toString('base64url'), encrypted.toString('base64url')].join('.')
}

export function decryptHhSecret(ciphertext: string, keyMaterial: string) {
  const [version, ivPart, authTagPart, dataPart] = ciphertext.split('.')
  if (version !== VERSION || !ivPart || !authTagPart || !dataPart) {
    throw new Error('Invalid encrypted token format')
  }

  const key = normalizeKey(keyMaterial)
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64url'))
  decipher.setAuthTag(Buffer.from(authTagPart, 'base64url'))

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ])

  return decrypted.toString('utf8')
}

function normalizeKey(keyMaterial: string) {
  const maybeBase64 = decodeBase64Loose(keyMaterial)
  const input = maybeBase64 ?? Buffer.from(keyMaterial, 'utf8')
  return createHash('sha256').update(input).digest()
}

function decodeBase64Loose(value: string) {
  // Accept both standard base64 and base64url key material forms.
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) return null

  try {
    const decoded = Buffer.from(normalized, 'base64')
    return decoded.length > 0 ? decoded : null
  } catch {
    return null
  }
}

export const HH_TOKEN_ENCRYPTION_KEY_MIN_LENGTH = 16

export function isHhEncryptionKeyStrongEnough(value: string | undefined) {
  return typeof value === 'string' && value.trim().length >= HH_TOKEN_ENCRYPTION_KEY_MIN_LENGTH
}
