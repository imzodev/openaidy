/**
 * Ecosystem Integration Tools
 *
 * Package manager integration, CI/CD generators, and deployment helpers.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface PackageManager {
  name: 'npm' | 'yarn' | 'pnpm';
  available: boolean;
  version?: string;
}

export interface CIGeneratorOptions {
  provider: 'github-actions' | 'gitlab-ci' | 'jenkins';
  nodeVersion?: string;
  testCommand?: string;
  buildCommand?: string;
}

/**
 * Detect available package managers
 */
export async function detectPackageManagers(): Promise<PackageManager[]> {
  const managers: PackageManager[] = [
    { name: 'npm', available: false },
    { name: 'yarn', available: false },
    { name: 'pnpm', available: false },
  ];

  for (const manager of managers) {
    try {
      const { execSync } = await import('node:child_process');
      execSync(`${manager.name} --version`, { stdio: 'ignore' });
      manager.available = true;
    } catch {
      manager.available = false;
    }
  }

  return managers;
}

/**
 * Generate GitHub Actions workflow
 */
export function generateGitHubActionsWorkflow(
  options: CIGeneratorOptions,
): string {
  const nodeVersion = options.nodeVersion || '20';
  const testCommand = options.testCommand || 'pnpm test';
  const buildCommand = options.buildCommand || 'pnpm build';

  return `# OpenAidy Addon CI/CD
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [${nodeVersion}]

    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js \${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node-version }}
          cache: 'pnpm'
          
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
        
      - name: Run tests
        run: ${testCommand}
        
      - name: Build
        run: ${buildCommand}
        
      - name: Upload coverage
        uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: coverage/

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${nodeVersion}
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
`;
}

/**
 * Generate GitLab CI configuration
 */
export function generateGitLabCIConfig(options: CIGeneratorOptions): string {
  const nodeVersion = options.nodeVersion || '20';

  return `# OpenAidy Addon CI/CD
stages:
  - test
  - build
  - deploy

test:
  stage: test
  image: node:${nodeVersion}
  script:
    - npm install -g pnpm
    - pnpm install --frozen-lockfile
    - pnpm test
  artifacts:
    reports:
      coverage: coverage/

build:
  stage: build
  image: node:${nodeVersion}
  script:
    - npm install -g pnpm
    - pnpm install --frozen-lockfile
    - pnpm build
  artifacts:
    paths:
      - dist/
    expire_in: 1 week
`;
}

/**
 * Generate Jenkinsfile
 */
export function generateJenkinsfile(options: CIGeneratorOptions): string {
  const _nodeVersion = options.nodeVersion || '20';

  return `// OpenAidy Addon CI/CD
pipeline {
  agent any
  
  stages {
    stage('Test') {
      steps {
        echo 'Testing addon...'
        sh 'npx pnpm install --frozen-lockfile'
        sh 'npx pnpm test'
      }
    }
    
    stage('Build') {
      steps {
        echo 'Building addon...'
        sh 'npx pnpm build'
      }
    }
    
    stage('Deploy') {
      when { branch 'main' }
      steps {
        echo 'Deploying addon...'
      }
    }
  }
  
  post {
    always {
      junit '**/test-results/**/*.xml'
      publishHTML target: [
        allowMissing: true,
        alwaysLinkToLastBuild: true,
        keepAll: true,
        reportDir: 'coverage',
        reportFiles: 'index.html',
        reportName: 'Coverage Report'
      ]
    }
  }
}
`;
}

/**
 * Generate Docker configuration
 */
export function generateDockerfile(addonId: string): string {
  return `# ${addonId} Addon Docker Image
FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package*.json ./

# Install dependencies
RUN pnpm install --frozen-lockfile --prod

# Copy source
COPY . .

# Build addon
RUN pnpm build

# Production image
FROM node:20-alpine
WORKDIR /app

# Copy built addon
COPY --from=0 /app/dist ./dist
COPY --from=0 /app/package.json ./

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Expose port
EXPOSE 3000

# Run addon
CMD ["node", "dist/index.js"]
`;
}

/**
 * Generate docker-compose.yml
 */
export function generateDockerCompose(addonId: string): string {
  return `version: '3.8'

services:
  ${addonId}:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
    restart: unless-stopped
    
  # Optional: Development mode with hot reload
  ${addonId}-dev:
    build:
      context: .
      target: development
    ports:
      - "3000:3000"
      - "3001:3001"
    environment:
      - NODE_ENV=development
      - DEBUG=true
    volumes:
      - .:/app
      - /app/node_modules
    command: pnpm dev
`;
}

/**
 * Generate Kubernetes deployment
 */
export function generateKubernetesManifest(addonId: string): string {
  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${addonId}
  labels:
    app: ${addonId}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ${addonId}
  template:
    metadata:
      labels:
        app: ${addonId}
    spec:
      containers:
      - name: ${addonId}
        image: ${addonId}:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        resources:
          requests:
            memory: "64Mi"
            cpu: "250m"
          limits:
            memory: "128Mi"
            cpu: "500m"
---
apiVersion: v1
kind: Service
metadata:
  name: ${addonId}
spec:
  selector:
    app: ${addonId}
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
`;
}

/**
 * Generate cloud deployment config (Vercel/Netlify)
 */
export function generateCloudConfig(provider: 'vercel' | 'netlify'): string {
  if (provider === 'vercel') {
    return `{
  "buildCommand": "pnpm build",
  "outputDirectory": "dist",
  "installCommand": "pnpm install",
  "framework": null
}`;
  }
  return `[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[build]
  command = "pnpm build"
  publish = "dist"
`;
}

/**
 * Check CI/CD compatibility
 */
export function checkCICDCompatibility(): {
  compatible: boolean;
  providers: string[];
  suggestions: string[];
} {
  return {
    compatible: true,
    providers: ['github-actions', 'gitlab-ci', 'jenkins', 'circleci', 'travis'],
    suggestions: [
      'GitHub Actions is recommended for GitHub repositories',
      'GitLab CI is recommended for GitLab repositories',
      'Jenkins is recommended for enterprise deployments',
    ],
  };
}

/**
 * Create ecosystem configuration file
 */
export async function createEcosystemConfig(
  projectPath: string,
  config: {
    packageManager?: 'npm' | 'yarn' | 'pnpm';
    ciProvider?: 'github-actions' | 'gitlab-ci' | 'jenkins' | 'none';
    docker?: boolean;
    kubernetes?: boolean;
  },
): Promise<{ success: boolean; createdFiles: string[] }> {
  const createdFiles: string[] = [];

  // Determine package manager (reserved for future use)
  const _pm = config.packageManager || 'pnpm';

  // Generate CI config
  if (config.ciProvider && config.ciProvider !== 'none') {
    let ciContent = '';
    switch (config.ciProvider) {
      case 'github-actions':
        ciContent = generateGitHubActionsWorkflow({
          provider: 'github-actions',
        });
        fs.writeFileSync(
          path.join(projectPath, '.github', 'workflows', 'ci.yml'),
          ciContent,
        );
        createdFiles.push('.github/workflows/ci.yml');
        break;
      case 'gitlab-ci':
        ciContent = generateGitLabCIConfig({ provider: 'gitlab-ci' });
        fs.writeFileSync(path.join(projectPath, '.gitlab-ci.yml'), ciContent);
        createdFiles.push('.gitlab-ci.yml');
        break;
      case 'jenkins':
        ciContent = generateJenkinsfile({ provider: 'jenkins' });
        fs.writeFileSync(path.join(projectPath, 'Jenkinsfile'), ciContent);
        createdFiles.push('Jenkinsfile');
        break;
    }
  }

  // Generate Docker config
  if (config.docker) {
    fs.writeFileSync(
      path.join(projectPath, 'Dockerfile'),
      generateDockerfile('addon'),
    );
    createdFiles.push('Dockerfile');

    fs.writeFileSync(
      path.join(projectPath, 'docker-compose.yml'),
      generateDockerCompose('addon'),
    );
    createdFiles.push('docker-compose.yml');
  }

  // Generate Kubernetes config
  if (config.kubernetes) {
    fs.mkdirSync(path.join(projectPath, 'k8s'), { recursive: true });
    fs.writeFileSync(
      path.join(projectPath, 'k8s', 'deployment.yml'),
      generateKubernetesManifest('addon'),
    );
    createdFiles.push('k8s/deployment.yml');
  }

  return { success: true, createdFiles };
}
