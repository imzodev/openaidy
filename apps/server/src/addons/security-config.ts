/**
 * Security Configuration Management
 *
 * Centralized security configuration with environment-specific settings,
 * feature flags, compliance profiles, and security policy management.
 */

import type {
  RequestValidationConfig,
  ResponseFilteringConfig,
} from './proxy-enhanced.js';

// ============================================================================
// Environment Configuration
// ============================================================================

export interface SecurityEnvironmentConfig {
  /** Security level: development, staging, production */
  level: 'development' | 'staging' | 'production';
  /** Enable debug logging */
  debug: boolean;
  /** Enable security audit mode */
  auditMode: boolean;
  /** Trusted proxies */
  trustedProxies: string[];
}

/**
 * Get environment-specific security configuration
 */
export function getSecurityEnvironmentConfig(): SecurityEnvironmentConfig {
  const env = process.env.NODE_ENV ?? 'development';

  return {
    level: env as 'development' | 'staging' | 'production',
    debug: env !== 'production',
    auditMode: env === 'production',
    trustedProxies: process.env.TRUSTED_PROXIES?.split(',') ?? [
      '127.0.0.1',
      '::1',
    ],
  };
}

// ============================================================================
// Feature Flags
// ============================================================================

export interface SecurityFeatureFlags {
  /** Enable enhanced proxy security */
  enhancedProxy: boolean;
  /** Enable rate limiting */
  rateLimiting: boolean;
  /** Enable audit logging */
  auditLogging: boolean;
  /** Enable code validation */
  codeValidation: boolean;
  /** Enable malware scanning */
  malwareScanning: boolean;
  /** Enable security headers */
  securityHeaders: boolean;
  /** Enable request validation */
  requestValidation: boolean;
  /** Enable response filtering */
  responseFiltering: boolean;
  /** Enable threat detection */
  threatDetection: boolean;
  /** Enable data protection */
  dataProtection: boolean;
  /** Enable cache */
  enableCache: boolean;
}

/**
 * Get feature flags based on environment
 */
export function getSecurityFeatureFlags(): SecurityFeatureFlags {
  const envConfig = getSecurityEnvironmentConfig();
  const isProduction = envConfig.level === 'production';

  return {
    enhancedProxy: true,
    rateLimiting: true,
    auditLogging: true,
    codeValidation: true,
    malwareScanning: true,
    securityHeaders: true,
    requestValidation: true,
    responseFiltering: true,
    threatDetection: true,
    dataProtection: true,
    enableCache: !isProduction, // Disable cache in production for security
  };
}

// ============================================================================
// Compliance Profiles
// ============================================================================

export type ComplianceProfile = 'gdpr' | 'hipaa' | 'pci-dss' | 'soc2' | 'none';

export interface ComplianceConfig {
  /** Active compliance profile */
  profile: ComplianceProfile;
  /** Enable GDPR data processing */
  gdprDataProcessing: boolean;
  /** Enable HIPAA compliance mode */
  hipaaMode: boolean;
  /** Enable PCI-DSS compliance */
  pciDssMode: boolean;
  /** Enable SOC2 compliance */
  soc2Mode: boolean;
  /** Retention period in days */
  retentionDays: number;
  /** Enable data encryption at rest */
  encryptAtRest: boolean;
  /** Enable data encryption in transit */
  encryptInTransit: boolean;
  /** Enable PII detection */
  piiDetection: boolean;
  /** Enable consent tracking */
  consentTracking: boolean;
}

/**
 * Get compliance configuration for a profile
 */
export function getComplianceConfig(
  profile: ComplianceProfile,
): ComplianceConfig {
  switch (profile) {
    case 'gdpr':
      return {
        profile: 'gdpr',
        gdprDataProcessing: true,
        hipaaMode: false,
        pciDssMode: false,
        soc2Mode: false,
        retentionDays: 365,
        encryptAtRest: true,
        encryptInTransit: true,
        piiDetection: true,
        consentTracking: true,
      };
    case 'hipaa':
      return {
        profile: 'hipaa',
        gdprDataProcessing: false,
        hipaaMode: true,
        pciDssMode: false,
        soc2Mode: false,
        retentionDays: 2190, // 6 years
        encryptAtRest: true,
        encryptInTransit: true,
        piiDetection: true,
        consentTracking: true,
      };
    case 'pci-dss':
      return {
        profile: 'pci-dss',
        gdprDataProcessing: false,
        hipaaMode: false,
        pciDssMode: true,
        soc2Mode: false,
        retentionDays: 365,
        encryptAtRest: true,
        encryptInTransit: true,
        piiDetection: true,
        consentTracking: false,
      };
    case 'soc2':
      return {
        profile: 'soc2',
        gdprDataProcessing: false,
        hipaaMode: false,
        pciDssMode: false,
        soc2Mode: true,
        retentionDays: 90,
        encryptAtRest: true,
        encryptInTransit: true,
        piiDetection: false,
        consentTracking: false,
      };
    case 'none':
    default:
      return {
        profile: 'none',
        gdprDataProcessing: false,
        hipaaMode: false,
        pciDssMode: false,
        soc2Mode: false,
        retentionDays: 30,
        encryptAtRest: false,
        encryptInTransit: true,
        piiDetection: false,
        consentTracking: false,
      };
  }
}

// ============================================================================
// Security Policy
// ============================================================================

export interface SecurityPolicy {
  /** Maximum request size in bytes */
  maxRequestSize: number;
  /** Maximum URL length */
  maxUrlLength: number;
  /** Maximum concurrent connections per IP */
  maxConnectionsPerIp: number;
  /** Request timeout in ms */
  requestTimeoutMs: number;
  /** Enable IP blocking */
  enableIpBlocking: boolean;
  /** Block threshold (suspicious requests) */
  blockThreshold: number;
  /** Enable request rate limiting */
  enableRateLimit: boolean;
  /** Rate limit window in seconds */
  rateLimitWindowSec: number;
  /** Rate limit max requests per window */
  rateLimitMaxRequests: number;
}

/**
 * Default security policy
 */
export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  maxRequestSize: 10 * 1024 * 1024, // 10MB
  maxUrlLength: 8192,
  maxConnectionsPerIp: 100,
  requestTimeoutMs: 30000,
  enableIpBlocking: true,
  blockThreshold: 100,
  enableRateLimit: true,
  rateLimitWindowSec: 60,
  rateLimitMaxRequests: 1000,
};

// ============================================================================
// Centralized Security Configuration
// ============================================================================

export interface SecurityConfiguration {
  /** Environment configuration */
  environment: SecurityEnvironmentConfig;
  /** Feature flags */
  featureFlags: SecurityFeatureFlags;
  /** Compliance configuration */
  compliance: ComplianceConfig;
  /** Security policy */
  policy: SecurityPolicy;
  /** Request validation config */
  validation: RequestValidationConfig;
  /** Response filtering config */
  responseFiltering: ResponseFilteringConfig;
}

/**
 * Get full security configuration
 */
export function getSecurityConfiguration(
  complianceProfile: ComplianceProfile = 'none',
): SecurityConfiguration {
  const environment = getSecurityEnvironmentConfig();
  const featureFlags = getSecurityFeatureFlags();
  const compliance = getComplianceConfig(complianceProfile);

  return {
    environment,
    featureFlags,
    compliance,
    policy: DEFAULT_SECURITY_POLICY,
    validation: {
      maxRequestSize: 10 * 1024 * 1024,
      allowedContentTypes: [
        'application/json',
        'application/x-www-form-urlencoded',
      ],
      requiredHeaders: [],
      maxUrlLength: 8192,
      sanitizeInput: true,
    },
    responseFiltering: {
      redactSensitiveData: true,
      maxResponseSize: 10 * 1024 * 1024,
      allowedHeaders: ['Content-Type', 'Authorization'],
      compressionEnabled: true,
    },
  };
}

/**
 * Update security configuration dynamically
 */
export class SecurityConfigManager {
  private config: SecurityConfiguration;
  private listeners: Set<(config: SecurityConfiguration) => void> = new Set();

  constructor(complianceProfile: ComplianceProfile = 'none') {
    this.config = getSecurityConfiguration(complianceProfile);
  }

  /**
   * Get current configuration
   */
  getConfig(): SecurityConfiguration {
    return { ...this.config };
  }

  /**
   * Update feature flags
   */
  updateFeatureFlags(flags: Partial<SecurityFeatureFlags>): void {
    this.config.featureFlags = {
      ...this.config.featureFlags,
      ...flags,
    };
    this.notifyListeners();
  }

  /**
   * Update security policy
   */
  updatePolicy(policy: Partial<SecurityPolicy>): void {
    this.config.policy = {
      ...this.config.policy,
      ...policy,
    };
    this.notifyListeners();
  }

  /**
   * Update validation config
   */
  updateValidation(config: Partial<RequestValidationConfig>): void {
    this.config.validation = {
      ...this.config.validation,
      ...config,
    };
    this.notifyListeners();
  }

  /**
   * Update response filtering
   */
  updateResponseFiltering(config: Partial<ResponseFilteringConfig>): void {
    this.config.responseFiltering = {
      ...this.config.responseFiltering,
      ...config,
    };
    this.notifyListeners();
  }

  /**
   * Enable/disable compliance profile
   */
  setComplianceProfile(profile: ComplianceProfile): void {
    this.config.compliance = getComplianceConfig(profile);
    this.notifyListeners();
  }

  /**
   * Subscribe to configuration changes
   */
  subscribe(listener: (config: SecurityConfiguration) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of configuration change
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.config);
    }
  }
}

// ============================================================================
// Default export
// ============================================================================

export default SecurityConfigManager;
