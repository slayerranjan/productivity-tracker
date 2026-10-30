-- UNDO for 20261030130000_login_usernames: removes the usernames (people can still sign in with their
-- employee ID or email, which were never changed). No employee data is touched.
DROP TABLE IF EXISTS "login_usernames";
