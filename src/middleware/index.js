import jwt from 'jsonwebtoken';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../utils/core.js';
import { User, TableSession } from '../models/index.js';

export const validate = schema => (req, _res, next) => {
  try { req.validated = schema.parse({ body: req.body, params: req.params, query: req.query }); next(); }
  catch (error) { next(error); }
};
export const auth = async (req, _res, next) => {
  try {
    const raw = req.cookies.accessToken || req.headers.authorization?.replace(/^Bearer /, '');
    if (!raw) throw new AppError(401, 'Authentication required', 'UNAUTHENTICATED');
    const payload = jwt.verify(raw, env.JWT_SECRET);
    const user = await User.findById(payload.sub).select('-passwordHash');
    if (!user?.active) throw new AppError(401, 'Account unavailable', 'UNAUTHENTICATED');
    req.user = user; next();
  } catch (error) { next(error instanceof AppError ? error : new AppError(401, 'Session expired', 'UNAUTHENTICATED')); }
};
export const allow = (...roles) => (req, _res, next) => roles.includes(req.user.role) ? next() : next(new AppError(403, 'Insufficient permission', 'FORBIDDEN'));
export const guestSession = async (req, _res, next) => {
  try {
    const raw = req.cookies.tableSession || req.headers['x-table-session'];
    const session = raw && await TableSession.findOne({ tokenHash: raw, status: 'active', expiresAt: { $gt: new Date() } });
    if (!session) throw new AppError(401, 'Table session expired or invalid', 'INVALID_TABLE_SESSION');
    req.tableSession = session; next();
  } catch (error) { next(error); }
};
export const notFound = (_req, _res, next) => next(new AppError(404, 'Route not found', 'NOT_FOUND'));
export const errors = (error, _req, res, _next) => {
  const isZod = error instanceof ZodError;
  const status = isZod ? 422 : error.status || (error.code === 11000 ? 409 : 500);
  const message = isZod ? 'Validation failed' : error.code === 11000 ? 'A unique value already exists' : error.message || 'Internal server error';
  res.status(status).json({ success: false, error: { code: isZod ? 'VALIDATION_ERROR' : error.code || 'INTERNAL_ERROR', message, ...(isZod && { details: error.issues }) } });
};

