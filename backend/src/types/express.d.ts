import 'express';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      clientIp?: string;
      rawBody?: Buffer;
      admin?: {
        id: string;
        sessionId: string;
      };
    }
  }
}

export {};
