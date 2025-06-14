import type { Format } from 'logform'
import { createLogger, format, transports, type Logger as LoggerLib } from 'winston'

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

const levels: Record<LoggerLevel, number> = {
  silly: 90,
  debug: 80,
  verbose: 70,
  http: 60,
  info: 50,
  help: 40,
  warn: 30,
  error: 20,
  critical: 10,
}

export type LoggerOptions = {
  level?: LoggerLevel
  prefix?: string
  showOutputAsJSON?: boolean
  isVerbose?: boolean
  onError?: (error: Error) => void
}

export class Logger {
  private readonly logger: LoggerLib

  constructor({ level, prefix, showOutputAsJSON, isVerbose, onError }: LoggerOptions = {}) {
    const formats: Array<Format> = [
      format((info) => {
        info.message = normalizeMessage(String(info.message), prefix)
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
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            `${timestamp} [${level}] ${message}${Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : ''}`,
        ),
      )
    } else {
      formats.push(
        format((info) => {
          info.originalLevel = info.level
          return info
        })(),
        format.colorize(),
        format.printf(
          ({ originalLevel, level, message }) =>
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            `${originalLevel === 'error' || originalLevel === 'warn' ? `[${level}] ` : ''}${message}`,
        ),
      )
    }

    this.logger = createLogger({
      levels,
      level: level,
      format: format.combine(...formats),
      transports: [TRANSPORT_CONSOLE],
    })
    this.logger.on('finish', this.flushLoggerTransports.bind(this) as () => void)

    if (onError) {
      this.logger.on('error', onError)
    }
  }

  private async flushLoggerTransports(): Promise<void> {
    const p = new Promise((resolve) => {
      process.stdout.once('drain', () => resolve(undefined))
    })
    process.stdout.write('')
    await p
  }

  silly(message: string): void {
    this.logger.silly(message)
  }

  debug(message: string): void {
    this.logger.debug(message)
  }

  verbose(message: string): void {
    this.logger.verbose(message)
  }

  http(message: string): void {
    this.logger.http(message)
  }

  info(message: string): void {
    this.logger.info(message)
  }

  help(message: string): void {
    this.logger.help(message)
  }

  warn(message: string): void {
    this.logger.warn(message)
  }

  error(message: string): void {
    this.logger.error(message)
  }

  critical(message: string): void {
    this.logger.crit(message)
  }

  end(cb?: () => void): this
  end(chunk: unknown, cb?: () => void): this
  end(chunk: unknown, encoding?: BufferEncoding, cb?: () => void): this
  end(...args: Array<unknown>): this {
    this.logger.end(...(args as Parameters<LoggerLib['end']>))
    return this
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
