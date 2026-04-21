/**
 * CLI Types for OpenAidy Addon Development
 */

export interface AddonProject {
  name: string;
  id: string;
  path: string;
  template: string;
}

export interface CLIConfig {
  name: string;
  version: string;
  description: string;
}

export const defaultCLIConfig: CLIConfig = {
  name: 'openaidy',
  version: '1.0.0',
  description: 'OpenAidy Addon Development CLI',
};

export enum ExitCodes {
  Success = 0,
  GeneralError = 1,
  InvalidInput = 2,
  FileNotFound = 3,
  BuildFailed = 4,
  ValidationFailed = 5,
}

export interface CommandResult {
  success: boolean;
  message: string;
  errors?: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
