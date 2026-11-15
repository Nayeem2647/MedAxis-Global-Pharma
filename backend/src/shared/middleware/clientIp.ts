import net from 'node:net';
import type { RequestHandler } from 'express';

export function clientIp({ trustCloudflare }: { trustCloudflare: boolean }): RequestHandler {
  return (req, _res, next) => {
    let ip = req.ip;
    if (trustCloudflare) {
      const cf = req.get('cf-connecting-ip');
      if (cf && net.isIP(cf.trim())) ip = cf.trim();
    }
    req.clientIp = ip;
    next();
  };
}
