const PREFIX = "[Adblockify]";

export function info(message: string): void {
  console.info(`${PREFIX} ${message}`);
}

export function warn(message: string): void {
  console.warn(`${PREFIX} ${message}`);
}

export function fail(message: string, error?: unknown): void {
  if (error === undefined) console.error(`${PREFIX} ${message}`);
  else console.error(`${PREFIX} ${message}`, error);
}
