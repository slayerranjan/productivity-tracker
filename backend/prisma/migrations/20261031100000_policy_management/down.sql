-- UNDO for 20261031100000_policy_management. Removes the draft/version/audience/category/review-note data.
-- The policy documents themselves (induction_documents), their files and every acknowledgement are NOT touched.
-- Any DRAFT policy's file stays in storage; its induction_documents row stays too (inactive).
DROP TABLE IF EXISTS "policy_review_notes";
DROP TABLE IF EXISTS "policy_categories";
DROP TABLE IF EXISTS "policy_audience";
DROP TABLE IF EXISTS "policy_versions";
DROP TABLE IF EXISTS "policy_details";
