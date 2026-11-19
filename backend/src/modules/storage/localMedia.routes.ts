import { Router } from 'express';
import { z } from 'zod';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { readLocalMediaFile, verifyLocalAvatarSignature } from './storage.service.js';

const PUBLIC_PRODUCT_KEY = /^products\/(?:local|s3)\/(?:(?:manufacturers|generics|categories|legacy)\/)?[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)$/;
const VIDEO_KEY = /^products\/(?:local|s3)\/videos\/[a-zA-Z0-9_-]+\.(?:mp4|webm)$/;
const AVATAR_KEY = /^avatars\/(?:local|s3)\/(?:legacy\/)?[a-zA-Z0-9_-]+\.(?:jpg|png|webp)$/;
const avatarQuery = z.strictObject({ expires: z.string(), sig: z.string() });

export function createLocalMediaRouter(env: AppEnv) {
  const router = Router();
  router.get(/.*/, async (req, res, next) => {
    if (env.STORAGE_DRIVER !== 'local' || env.isProduction) return next();
    let key: string;
    try {
      key = decodeURIComponent(req.path.replace(/^\/+/, ''));
    } catch {
      throw AppError.badRequest('Invalid media path.');
    }
    if (key.startsWith('products/')) {
      z.object({}).strict().parse(req.query);
      if (!PUBLIC_PRODUCT_KEY.test(key) && !VIDEO_KEY.test(key)) throw AppError.notFound();
      const file = await readLocalMediaFile(env, 'products', key);
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (VIDEO_KEY.test(key)) {
        res.setHeader('Accept-Ranges', 'bytes');
        if (req.headers.range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
          const size = file.bytes.length;
          const start = match?.[1] ? Number(match[1]) : match?.[2] ? Math.max(0, size - Number(match[2])) : NaN;
          const end = match?.[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size || (!match?.[1] && Number(match?.[2]) === 0)) {
            res.setHeader('Content-Range', 'bytes */' + size);
            res.status(416).end();
            return;
          }
          res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
          res.status(206).send(file.bytes.subarray(start, end + 1));
          return;
        }
      }
      res.send(file.bytes);
      return;
    }
    if (key.startsWith('avatars/')) {
      const query = avatarQuery.parse(req.query);
      if (!AVATAR_KEY.test(key)) throw AppError.notFound();
      if (!verifyLocalAvatarSignature(env, key, query.expires, query.sig)) {
        throw AppError.forbidden('Avatar link is invalid or expired.');
      }
      const file = await readLocalMediaFile(env, 'avatars', key);
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(file.bytes);
      return;
    }
    return next();
  });
  return router;
}
