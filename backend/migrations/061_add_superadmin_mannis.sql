-- Add mannis2025@gmail.com as super admin with Thunder Bay Regional Health Sciences Foundation

-- Insert the user if they don't already exist
INSERT INTO users (email, is_super_admin, email_verified, created_at)
VALUES ('mannis2025@gmail.com', TRUE, TRUE, NOW())
ON CONFLICT (email) DO UPDATE SET is_super_admin = TRUE;

-- Associate user with Thunder Bay org as owner (if org exists)
INSERT INTO organization_memberships (user_id, organization_id, role, accepted_at, created_at)
SELECT u.id, o.id, 'owner', NOW(), NOW()
FROM users u, organizations o
WHERE u.email = 'mannis2025@gmail.com'
  AND o.name = 'Thunder Bay Regional Health Sciences Foundation'
ON CONFLICT (user_id, organization_id) DO UPDATE SET role = 'owner';
