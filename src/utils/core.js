import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export class AppError extends Error {
  constructor(status, message, code = 'REQUEST_ERROR', details) {
    super(message); this.status = status; this.code = code; this.details = details;
  }
}
export const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export const ok = (res, data, status = 200, meta) => res.status(status).json({ success: true, data, ...(meta && { meta }) });
export const token = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const hashToken = value => crypto.createHash('sha256').update(value).digest('hex');
const encryptionKey = () => crypto.createHash('sha256').update(env.COOKIE_SECRET).digest();
export const encryptToken = value => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
};
export const decryptToken = value => {
  const [iv, tag, encrypted] = String(value).split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
};
export const signAccess = user => jwt.sign({ sub: user.id, role: user.role, type: 'access' }, env.JWT_SECRET, { expiresIn: '15m' });
export const signRefresh = (user, id) => jwt.sign({ sub: user.id, jti: id, type: 'refresh' }, env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
export const money = values => values.reduce((sum, value) => sum + value, 0);

