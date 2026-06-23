import { createLogger, format, transports } from 'winston';

// Serverless platforms (Vercel, Lambda) have a read-only filesystem, so the
// winston File transport — which mkdir's a `logs/` dir on construction — would
// crash the function at import. Use console-only there; logs go to the
// platform's log drain. Docker/Pi keep file transports for persistent logs.
const isServerless = process.env.SERVERLESS === '1' || !!process.env.VERCEL;

export const logger = createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.splat(),
    format.json()
  ),
  defaultMeta: { service: 'shard-backend' },
  transports: isServerless
    ? []
    : [
        new transports.File({ filename: 'logs/error.log', level: 'error' }),
        new transports.File({ filename: 'logs/combined.log' }),
      ],
});

// Console transport in all environments — Docker captures stdout/stderr
logger.add(
  new transports.Console({
    format: format.combine(format.colorize(), format.simple()),
    silent: process.env.NODE_ENV === 'test',
  })
);
