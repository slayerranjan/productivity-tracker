-- UNDO for 20261029120000_employment_type_and_requirement_scope.
-- Removes the two small tables (chosen employment types and requirement scopes are lost;
-- documents, requirements and employees are untouched).
DROP TABLE IF EXISTS "document_requirement_scopes";
DROP TABLE IF EXISTS "employee_profiles";
DROP TYPE IF EXISTS "EmploymentType";
