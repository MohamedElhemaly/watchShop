// Sodfa (صُدْفَة) - Admin Users & RBAC Alias Endpoint (/api/users)
// Provides clean RESTful access to admin user management in Turso Cloud DB.

import authHandler from "./auth.js";

export default async function handler(req, res) {
  if (req.method === "GET" && !req.query?.action) {
    req.query = { ...req.query, action: "admins" };
  } else if (req.method === "POST" && !req.body?.action) {
    req.body = { ...(req.body || {}), action: "create-admin" };
  } else if (req.method === "PUT" && !req.body?.action) {
    req.body = { ...(req.body || {}), action: "update-admin" };
  } else if (req.method === "DELETE" && !req.body?.action) {
    req.body = { ...(req.body || {}), action: "delete-admin" };
  }

  return authHandler(req, res);
}
