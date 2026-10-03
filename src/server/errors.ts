// Error types shared by the server modules. Mapped to HTTP responses in api.ts.

/** An error that already knows its HTTP status and public error code. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

/** The slug is already used by another post (unique violation). */
export class SlugTakenError extends Error {
  constructor() {
    super("slug_taken");
    this.name = "SlugTakenError";
  }
}

/** Another automation run already filled this publication slot. */
export class SlotTakenError extends Error {
  constructor(slot: Date) {
    super(`An auto post already exists at ${slot.toISOString()}`);
    this.name = "SlotTakenError";
  }
}

/** The generation pipeline could not produce a usable article. */
export class GenerationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GenerationError";
    this.code = code;
  }
}

/** A Supabase/PostgREST error, with its Postgres or PostgREST code when known. */
export class DatabaseError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(`Database error: ${message}`);
    this.name = "DatabaseError";
    this.code = code;
  }
}

/** Missing or invalid server configuration (environment variables). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "Unknown error";
}
