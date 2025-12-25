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
  const expectedKey = process.env.TRAFFIC_DOCTOR_API_KEY || process.env.WORKER_API_KEY;
  
  // Check if API key is configured on worker
  if (!expectedKey) {
    return res.status(500).json({
      ok: false,
      error: { code: "server_error", message: "API key not configured on worker" }
    });
  }
  
  // Accept either x-api-key OR Authorization: Bearer
  const apiKey = req.headers["x-api-key"] as string
    || (req.headers["authorization"]?.replace("Bearer ", "") as string);
  
  if (!apiKey) {
    return res.status(401).json({
      ok: false,
      error: { code: "unauthorized", message: "API key required" }
    });
  }
  
  if (apiKey !== expectedKey) {
    return res.status(401).json({
      ok: false,
      error: { code: "unauthorized", message: "Invalid API key" }
    });
  }
  
  req.user = { authenticated: true };
  next();
}

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}
