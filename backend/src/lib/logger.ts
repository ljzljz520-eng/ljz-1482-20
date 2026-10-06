type Level = "debug" | "info" | "warn" | "error";

const write = (level: Level, message: string, context: Record<string, unknown> = {}) => {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service: "creator-workbench",
    message,
    ...context
  });
  if (level === "error") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
};

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => write("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => write("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => write("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => write("error", message, context)
};
