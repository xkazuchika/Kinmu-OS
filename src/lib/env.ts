type EnvironmentMode = "development" | "test" | "production";
type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export type RuntimeEnvironment = Readonly<{
  appUrl: URL;
  databaseUrl: string;
  nodeEnv: EnvironmentMode;
  sessionSecret: string;
  sourceCodeUrl: URL;
  appVersion: string;
}>;

export class EnvironmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvironmentValidationError";
  }
}

function readEnvironmentMode(source: EnvironmentSource): EnvironmentMode {
  const nodeEnv = (source.NODE_ENV ?? "development") as EnvironmentMode;

  if (!environmentModes.has(nodeEnv)) {
    throw new EnvironmentValidationError("NODE_ENV must be development, test, or production.");
  }

  return nodeEnv;
}

const environmentModes = new Set<EnvironmentMode>(["development", "test", "production"]);

function required(
  source: EnvironmentSource,
  name: "DATABASE_URL" | "APP_URL" | "SESSION_SECRET",
  fallback?: string,
): string {
  const value = source[name] ?? fallback;

  if (!value) {
    throw new EnvironmentValidationError(`${name} must be configured.`);
  }

  return value;
}

function parseUrl(name: string, value: string, schemes: string[]): URL {
  try {
    const parsed = new URL(value);

    if (!schemes.includes(parsed.protocol)) {
      throw new EnvironmentValidationError(`${name} must use one of: ${schemes.join(", ")}.`);
    }

    return parsed;
  } catch (error) {
    if (error instanceof EnvironmentValidationError) {
      throw error;
    }

    throw new EnvironmentValidationError(`${name} must be a valid URL.`);
  }
}

export function loadEnvironment(source: EnvironmentSource = process.env): RuntimeEnvironment {
  const nodeEnv = readEnvironmentMode(source);
  const isProduction = nodeEnv === "production";
  const databaseUrl = loadDatabaseUrl(source);
  const appUrl = parseUrl(
    "APP_URL",
    required(source, "APP_URL", isProduction ? undefined : "http://localhost:3000"),
    ["http:", "https:"],
  );
  const sessionSecret = required(
    source,
    "SESSION_SECRET",
    isProduction ? undefined : "development-session-secret-change-me",
  );
  const sourceCodeUrl = parseUrl(
    "SOURCE_CODE_URL",
    source.SOURCE_CODE_URL ?? "https://github.com/xkazuchika/Kinmu-OS",
    ["http:", "https:"],
  );
  const appVersion = source.APP_VERSION?.trim() || "0.1.0";

  if (isProduction && sessionSecret.length < 32) {
    throw new EnvironmentValidationError(
      "SESSION_SECRET must contain at least 32 characters in production.",
    );
  }

  return Object.freeze({ appUrl, appVersion, databaseUrl, nodeEnv, sessionSecret, sourceCodeUrl });
}

export function loadDatabaseUrl(source: EnvironmentSource = process.env): string {
  const nodeEnv = readEnvironmentMode(source);
  const databaseUrl =
    nodeEnv === "test"
      ? (source.TEST_DATABASE_URL ?? "postgresql://kinmu:kinmu@localhost:5432/kinmu_test")
      : required(
          source,
          "DATABASE_URL",
          nodeEnv === "production" ? undefined : "postgresql://kinmu:kinmu@localhost:5432/kinmu",
        );

  parseUrl("DATABASE_URL", databaseUrl, ["postgres:", "postgresql:"]);
  return databaseUrl;
}
