-- Only run before Google accounts have been linked, or after deciding to remove
-- those identity links. Existing portal users and passwords are not affected.
DROP TABLE "GoogleIdentity";
