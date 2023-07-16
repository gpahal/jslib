import { Format } from 'logform'
import { createLogger, format, Logger as LibLogger, transports } from 'winston'

const TRANSPORT_CONSOLE = new transports.Console()

export type LoggerLevel =
  | 'silly'
  | 'debug'
  | 'verbose'
  | 'http'
  | 'info'
  | 'help'
  | 'warn'
  | 'error'
  | 'critical'
  | 'silent'

const levels: Record<LoggerLevel, number> = {
  silly: 10,
  debug: 20,
  verbose: 30,
  http: 40,
  info: 50,
  help: 60,
  warn: 70,
  error: 80,
  critical: 90,
  silent: 100,
}

export type LoggerOptions = {
  level?: LoggerLevel
  prefix?: string
  showOutputAsJSON?: boolean
  isVerbose?: boolean
}

export class Logger {
  readonly #logger: LibLogger

  constructor({ level, prefix, showOutputAsJSON, isVerbose }: LoggerOptions = {}) {
    const formats: Format[] = [
      format((info) => {
        info.message = normalizeMessage(String(info.message), prefix)
        info['originalLevel'] = info.level
        return info
      })(),
    ]
    if (isVerbose) {
      formats.push(format.timestamp())
    }

    if (showOutputAsJSON) {
      formats.push(format.json())
    } else if (isVerbose) {
      formats.push(
        format.colorize(),
        format.align(),
        format.printf(
          ({ timestamp, level, message, ...rest }) =>
            `${timestamp} [${level}] ${message}${Object.keys(rest).length > 0 ? ` ${JSON.stringify(2)}` : ''}`,
        ),
      )
    } else {
      formats.push(
        format((info) => {
          info['originalLevel'] = info.level
          return info
        })(),
        format.colorize(),
        format.printf(
          ({ originalLevel, level, message }) =>
            `${originalLevel === 'error' || originalLevel === 'warn' ? `[${level}] ` : ''}${message}`,
        ),
      )
    }

    this.#logger = createLogger({
      levels,
      level,
      format: format.combine(...formats),
      transports: [TRANSPORT_CONSOLE],
    })
    this.#logger.on('finish', this.#flushLoggerTransports.bind(this) as () => void)
  }

  async #flushLoggerTransports(): Promise<void> {
    const p = new Promise((resolve) => {
      process.stdout.once('drain', () => resolve(undefined))
    })
    process.stdout.write('')
    await p
  }

  silly(message: string): void {
    this.#logger.silly(message)
  }

  debug(message: string): void {
    this.#logger.debug(message)
  }

  verbose(message: string): void {
    this.#logger.verbose(message)
  }

  http(message: string): void {
    this.#logger.http(message)
  }

  info(message: string): void {
    this.#logger.info(message)
  }

  help(message: string): void {
    this.#logger.help(message)
  }

  warn(message: string): void {
    this.#logger.warn(message)
  }

  error(message: string): void {
    this.#logger.error(message)
  }

  critical(message: string): void {
    this.#logger.crit(message)
  }
}

function normalizeMessage(message: string, prefix?: string): string {
  return `${prefix ? `[${prefix}] ` : ''}${message
    .trim()
    .replace(/^silly:/i, '')
    .replace(/^debug:/i, '')
    .replace(/^verbose:/i, '')
    .replace(/^http:/i, '')
    .replace(/^info:/i, '')
    .replace(/^warn:/i, '')
    .replace(/^error:/i, '')
    .replace(/^fatal:/i, '')
    .trim()}`
}
