/**
 * Minimal logger abstraction used by the pipeline so callers can suppress
 * or redirect output without coupling to `console.*`.
 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const PREFIX = "[intelligence]";

export const consoleLogger: Logger = {
  info: (message) => console.log(`${PREFIX} ${message}`),
  warn: (message) => console.warn(`${PREFIX} ${message}`),
  error: (message) => console.error(`${PREFIX} ${message}`),
};

export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
