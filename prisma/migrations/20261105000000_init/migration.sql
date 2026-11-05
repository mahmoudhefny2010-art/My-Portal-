-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER', 'VIEWER');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('UNKNOWN', 'ONLINE', 'OFFLINE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('NOT_CONFIGURED', 'CONFIGURATION_REQUIRED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "CapabilityStatus" AS ENUM ('UNAVAILABLE', 'CONFIGURATION_REQUIRED', 'READY', 'ACTIVE');

-- CreateEnum
CREATE TYPE "ThemePreference" AS ENUM ('DARK', 'LIGHT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('PROJECT_OFFLINE', 'PROJECT_ONLINE', 'INTEGRATION_FAILED', 'INTEGRATION_CONNECTED', 'ADMIN_CHANGE', 'SECURITY_WARNING', 'AUDIT_INTEGRATION_FAILURE', 'SYNCHRONIZATION_FAILURE');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalSession" (
    "sid" VARCHAR(128) NOT NULL,
    "data" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalSession_pkey" PRIMARY KEY ("sid")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "siteUrl" VARCHAR(2048) NOT NULL,
    "adminUrl" VARCHAR(2048) NOT NULL,
    "faviconUrl" VARCHAR(2048),
    "category" VARCHAR(80),
    "status" "ProjectStatus" NOT NULL DEFAULT 'UNKNOWN',
    "integrationStatus" "IntegrationStatus" NOT NULL DEFAULT 'CONFIGURATION_REQUIRED',
    "statusMessage" VARCHAR(500),
    "responseMs" INTEGER,
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "nextHealthCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectIntegration" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "framePolicy" VARCHAR(40) NOT NULL DEFAULT 'UNKNOWN',
    "framePolicyMessage" VARCHAR(500),
    "webhookSecretCiphertext" TEXT,
    "webhookSecretNonce" VARCHAR(64),
    "webhookSecretTag" VARCHAR(64),
    "webhookConfiguredAt" TIMESTAMP(3),
    "lastSignedEventAt" TIMESTAMP(3),
    "frameOrigin" VARCHAR(2048),
    "embeddingVerifiedAt" TIMESTAMP(3),
    "authenticationVerifiedAt" TIMESTAMP(3),
    "embeddingVerifiedById" UUID,
    "liveAuditCapability" "CapabilityStatus" NOT NULL DEFAULT 'CONFIGURATION_REQUIRED',
    "syncCapability" "CapabilityStatus" NOT NULL DEFAULT 'CONFIGURATION_REQUIRED',
    "conflictCapability" "CapabilityStatus" NOT NULL DEFAULT 'CONFIGURATION_REQUIRED',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAccess" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "canManage" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectHealthCheck" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "status" "ProjectStatus" NOT NULL,
    "responseMs" INTEGER,
    "httpStatus" INTEGER,
    "message" VARCHAR(500),
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectHealthCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalAuditEvent" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "projectId" UUID,
    "action" VARCHAR(100) NOT NULL,
    "targetType" VARCHAR(80) NOT NULL,
    "targetId" VARCHAR(120),
    "summary" VARCHAR(500) NOT NULL,
    "details" JSONB,
    "source" VARCHAR(40) NOT NULL DEFAULT 'PORTAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalAuditEventReference" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "externalEventId" VARCHAR(160) NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "entityType" VARCHAR(80) NOT NULL,
    "entityId" VARCHAR(160),
    "actorLabel" VARCHAR(120),
    "actorReference" VARCHAR(160),
    "severity" VARCHAR(20) NOT NULL DEFAULT 'INFO',
    "changes" JSONB,
    "happenedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalAuditEventReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationCapability" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "status" "CapabilityStatus" NOT NULL DEFAULT 'CONFIGURATION_REQUIRED',
    "evidence" VARCHAR(500),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationVerification" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "outcome" VARCHAR(40) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "httpStatus" INTEGER,
    "framePolicy" VARCHAR(40) NOT NULL,
    "durationMs" INTEGER,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "projectId" UUID,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(140) NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "theme" "ThemePreference" NOT NULL DEFAULT 'DARK',
    "accentColor" VARCHAR(7) NOT NULL DEFAULT '#8b5cf6',
    "notificationSettings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalConfiguration" (
    "id" VARCHAR(30) NOT NULL DEFAULT 'main',
    "portalName" VARCHAR(120) NOT NULL DEFAULT 'Control Portal',
    "logoUrl" VARCHAR(2048),
    "accentColor" VARCHAR(7) NOT NULL DEFAULT '#8b5cf6',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthenticationAttempt" (
    "id" UUID NOT NULL,
    "identityKey" VARCHAR(64) NOT NULL,
    "networkKey" VARCHAR(64) NOT NULL,
    "succeeded" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthenticationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "PortalSession_expiresAt_idx" ON "PortalSession"("expiresAt");

-- CreateIndex
CREATE INDEX "PortalSession_userId_expiresAt_idx" ON "PortalSession"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Project_adminUrl_key" ON "Project"("adminUrl");

-- CreateIndex
CREATE INDEX "Project_archivedAt_createdAt_idx" ON "Project"("archivedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Project_status_archivedAt_idx" ON "Project"("status", "archivedAt");

-- CreateIndex
CREATE INDEX "Project_nextHealthCheckAt_idx" ON "Project"("nextHealthCheckAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectIntegration_projectId_key" ON "ProjectIntegration"("projectId");

-- CreateIndex
CREATE INDEX "ProjectAccess_projectId_idx" ON "ProjectAccess"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectAccess_userId_projectId_key" ON "ProjectAccess"("userId", "projectId");

-- CreateIndex
CREATE INDEX "ProjectHealthCheck_projectId_checkedAt_idx" ON "ProjectHealthCheck"("projectId", "checkedAt");

-- CreateIndex
CREATE INDEX "PortalAuditEvent_createdAt_idx" ON "PortalAuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "PortalAuditEvent_projectId_createdAt_idx" ON "PortalAuditEvent"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "PortalAuditEvent_actorUserId_createdAt_idx" ON "PortalAuditEvent"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalAuditEventReference_projectId_happenedAt_idx" ON "ExternalAuditEventReference"("projectId", "happenedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalAuditEventReference_projectId_externalEventId_key" ON "ExternalAuditEventReference"("projectId", "externalEventId");

-- CreateIndex
CREATE INDEX "IntegrationCapability_projectId_status_idx" ON "IntegrationCapability"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationCapability_projectId_name_key" ON "IntegrationCapability"("projectId", "name");

-- CreateIndex
CREATE INDEX "IntegrationVerification_projectId_verifiedAt_idx" ON "IntegrationVerification"("projectId", "verifiedAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

-- CreateIndex
CREATE INDEX "AuthenticationAttempt_identityKey_occurredAt_idx" ON "AuthenticationAttempt"("identityKey", "occurredAt");

-- CreateIndex
CREATE INDEX "AuthenticationAttempt_networkKey_occurredAt_idx" ON "AuthenticationAttempt"("networkKey", "occurredAt");

-- AddForeignKey
ALTER TABLE "PortalSession" ADD CONSTRAINT "PortalSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectIntegration" ADD CONSTRAINT "ProjectIntegration_embeddingVerifiedById_fkey" FOREIGN KEY ("embeddingVerifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectIntegration" ADD CONSTRAINT "ProjectIntegration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAccess" ADD CONSTRAINT "ProjectAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAccess" ADD CONSTRAINT "ProjectAccess_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectHealthCheck" ADD CONSTRAINT "ProjectHealthCheck_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalAuditEvent" ADD CONSTRAINT "PortalAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalAuditEvent" ADD CONSTRAINT "PortalAuditEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalAuditEventReference" ADD CONSTRAINT "ExternalAuditEventReference_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationCapability" ADD CONSTRAINT "IntegrationCapability_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationVerification" ADD CONSTRAINT "IntegrationVerification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
