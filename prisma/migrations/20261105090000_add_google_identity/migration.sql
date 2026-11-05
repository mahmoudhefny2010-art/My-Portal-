-- Add a separate optional identity table so existing User queries stay compatible
-- while old deployments have not applied this migration yet.
CREATE TABLE "GoogleIdentity" (
    "id" UUID NOT NULL,
    "googleSubject" VARCHAR(255) NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleIdentity_googleSubject_key" ON "GoogleIdentity"("googleSubject");
CREATE UNIQUE INDEX "GoogleIdentity_userId_key" ON "GoogleIdentity"("userId");

ALTER TABLE "GoogleIdentity"
  ADD CONSTRAINT "GoogleIdentity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
