import type { Server } from 'node:http';
import mongoose, { type Mongoose } from 'mongoose';
import type { AppEnv } from './env.js';
import type { AppLogger } from '../shared/utils/logger.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function maskMongoUri(uri: string): string {
  return uri.replace(/\/\/([^@/]+)@/, '//***:***@');
}

export interface TopologyInfo {
  supported: boolean;
  setName?: string;
  topology: 'replica-set' | 'sharded' | 'standalone';
}

export async function detectTransactionSupport(connection = mongoose.connection): Promise<TopologyInfo> {
  if (!connection.db) {
    return { supported: false, topology: 'standalone' };
  }
  const hello = await connection.db.admin().command({ hello: 1 });
  const setName = typeof hello.setName === 'string' ? hello.setName : undefined;
  const msg = typeof hello.msg === 'string' ? hello.msg : undefined;
  const supported = Boolean(setName) || msg === 'isdbgrid';
  return {
    supported,
    setName,
    topology: setName ? 'replica-set' : msg === 'isdbgrid' ? 'sharded' : 'standalone',
  };
}

export async function connectDatabase(
  env: Pick<
    AppEnv,
    'MONGODB_URI' | 'isProduction' | 'DB_CONNECT_RETRIES' | 'DB_CONNECT_RETRY_DELAY_MS' | 'DB_REQUIRE_REPLICA_SET'
  >,
  logger: AppLogger,
  { mongooseInstance = mongoose }: { mongooseInstance?: Mongoose } = {},
): Promise<Mongoose> {
  mongooseInstance.set('strictQuery', true);

  const connection = mongooseInstance.connection;
  connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  connection.on('error', (err: unknown) => logger.error('MongoDB connection error', { err }));

  const options = {
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
    maxPoolSize: 20,
    retryWrites: true,
    w: 'majority' as const,
    autoIndex: !env.isProduction,
  };

  const attempts = env.DB_CONNECT_RETRIES + 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      logger.info('Connecting to MongoDB', { attempt, attempts, uri: maskMongoUri(env.MONGODB_URI) });
      await mongooseInstance.connect(env.MONGODB_URI, options);
      lastError = undefined;
      break;
    } catch (err) {
      lastError = err;
      logger.error('MongoDB connection attempt failed', { attempt, attempts, err });
      if (attempt < attempts) {
        const delay = Math.min(env.DB_CONNECT_RETRY_DELAY_MS * 2 ** (attempt - 1), 30_000);
        logger.warn('Retrying MongoDB connection', { delay_ms: delay });
        await sleep(delay);
      }
    }
  }
  if (lastError) {
    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`Unable to connect to MongoDB after ${attempts} attempt(s): ${msg}`, { cause: lastError });
  }

  const topology = await detectTransactionSupport(connection);
  if (topology.supported) {
    logger.info('MongoDB connected', { topology: topology.topology, replica_set: topology.setName });
  } else if (env.DB_REQUIRE_REPLICA_SET) {
    await mongooseInstance.disconnect();
    throw new Error(
      'MongoDB must run as a replica set (Atlas) to support transactions. Standalone servers are not permitted.',
    );
  } else {
    logger.warn(
      'MongoDB is standalone: multi-document transactions are unavailable. Use a replica set (Atlas or local rs) before Step 5+.',
    );
  }

  return mongooseInstance;
}

export async function disconnectDatabase(mongooseInstance: Mongoose = mongoose): Promise<void> {
  if (mongooseInstance.connection.readyState !== 0) {
    await mongooseInstance.disconnect();
  }
}

export interface DatabaseHealth {
  status: 'connected' | 'disconnected' | 'unreachable';
}

export type CheckDatabaseFn = () => Promise<DatabaseHealth>;

export async function checkDatabase({
  mongooseInstance = mongoose,
  timeoutMs = 2000,
}: { mongooseInstance?: Mongoose; timeoutMs?: number } = {}): Promise<DatabaseHealth> {
  const connection = mongooseInstance.connection;
  if (connection.readyState !== 1 || !connection.db) {
    return { status: 'disconnected' };
  }
  try {
    await Promise.race([
      connection.db.admin().ping(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('ping timeout')), timeoutMs).unref()),
    ]);
    return { status: 'connected' };
  } catch {
    return { status: 'unreachable' };
  }
}

export function registerGracefulShutdown({
  server,
  logger,
  disconnect = disconnectDatabase,
  forceExitMs = 10_000,
  beforeClose,
  exit = process.exit,
}: {
  server?: Server;
  logger: AppLogger;
  disconnect?: () => Promise<void>;
  forceExitMs?: number;
  beforeClose?: () => void | Promise<void>;
  exit?: (code?: number) => never;
}): (signal: string, exitCode?: number) => Promise<void> {
  let shuttingDown = false;

  const shutdown = async (signal: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutdown initiated', { signal });

    const forceTimer = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      exit(1);
    }, forceExitMs);
    forceTimer.unref();

    try {
      await beforeClose?.();
      if (server) {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeIdleConnections?.();
        });
      }
      await disconnect();
      logger.info('Shutdown complete');
      exit(exitCode);
    } catch (err) {
      logger.error('Error during shutdown', { err });
      exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { err: reason instanceof Error ? reason : new Error(String(reason)) });
  });
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { err });
    void shutdown('uncaughtException', 1);
  });

  return shutdown;
}
