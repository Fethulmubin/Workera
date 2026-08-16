import pino from 'pino';

export const createLogger = (name: string) => {
  const isProduction = process.env.NODE_ENV === 'production';

  return pino({
    name,
    level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
    transport: !isProduction
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  });
};

export type Logger = ReturnType<typeof createLogger>;