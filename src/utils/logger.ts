export class Logger {
  static info(message: string, ...args: any[]): void {
    console.log(`[INFO] ${new Date().toISOString()} - ${message}`, ...args);
  }

  static warn(message: string, ...args: any[]): void {
    console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, ...args);
  }

  static error(message: string, ...args: any[]): void {
    console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, ...args);
  }

  static debug(message: string, ...args: any[]): void {
    if (process.env.DEBUG_MODE === 'true') {
      console.debug(`[DEBUG] ${new Date().toISOString()} - ${message}`, ...args);
    }
  }
}
