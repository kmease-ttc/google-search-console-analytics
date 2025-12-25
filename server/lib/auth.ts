import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

// Support multiple naming conventions
const JWT_SECRET = process.env.TRAFFIC_DOCTOR_API_KEY || process.env.JWT_SHARED_SECRET || "";

export interface JWTPayload {
  [key: string]: any;
}

export function verifyJWT(token: string): JWTPayload {
  if (!JWT_SECRET) {
    throw new Error("JWT_SHARED_SECRET not configured");
  }
  return jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as JWTPayload;
}

export function signJWT(payload: JWTPayload): string {
  if (!JWT_SECRET) {
    throw new Error("JWT_SHARED_SECRET not configured");
  }
  return jwt.sign(payload, JWT_SECRET, { algorithm: "HS256", expiresIn: "5m" });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Support both Authorization: Bearer and x-api-key header
  const authHeader = req.headers.authorization;
  const apiKey = req.headers["x-api-key"] as string | undefined;
  
  // Check x-api-key first (simple key comparison)
  if (apiKey) {
    if (apiKey === JWT_SECRET) {
      req.user = { authenticated: true, method: "api-key" };
      return next();
    }
    return res.status(401).json({ error: "unauthorized" });
  }
  
  // Fall back to Bearer token (JWT verification)
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const token = authHeader.substring(7);
  
  try {
    req.user = verifyJWT(token);
    next();
  } catch (error) {
    return res.status(401).json({ error: "unauthorized" });
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}
