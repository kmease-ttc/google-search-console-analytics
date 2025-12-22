import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { requireAuth, signJWT, verifyJWT } from "./lib/auth";
import { createOAuth2Client, REQUIRED_SCOPES, getAuthenticatedClient, handleGoogleAPIError, retryWithBackoff } from "./lib/google";
import { google } from "googleapis";
import { z } from "zod";

const AI_DOCTOR_BASE_URL = process.env.AI_DOCTOR_BASE_URL;

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.json({ status: "healthy", service: "ai-doctor-google-connector" });
  });

  // OAuth flow - Start
  app.get("/auth/start", (req, res) => {
    const { website_id } = req.query;

    if (!website_id || typeof website_id !== "string") {
      return res.status(400).json({ error: "BAD_REQUEST", message: "website_id query parameter is required" });
    }

    try {
      const oauth2Client = createOAuth2Client();
      
      // Sign the state with website_id
      const state = signJWT({ website_id });

      const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: REQUIRED_SCOPES,
        state,
        prompt: "consent", // Force consent to get refresh token
      });

      res.redirect(authUrl);
    } catch (error: any) {
      res.status(500).json({ error: "OAUTH_ERROR", message: error.message });
    }
  });

  // OAuth flow - Callback
  app.get("/auth/callback", async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
      return res.status(400).json({ error: "OAUTH_ERROR", message: error as string });
    }

    if (!code || !state || typeof code !== "string" || typeof state !== "string") {
      return res.status(400).json({ error: "BAD_REQUEST", message: "Missing code or state parameter" });
    }

    try {
      // Verify and decode state
      const decoded = verifyJWT(state);
      const websiteId = decoded.website_id;

      if (!websiteId) {
        return res.status(400).json({ error: "INVALID_STATE", message: "Invalid state parameter" });
      }

      const oauth2Client = createOAuth2Client();
      const { tokens } = await oauth2Client.getToken(code);

      if (!tokens.access_token || !tokens.refresh_token || !tokens.expiry_date) {
        return res.status(500).json({ error: "TOKEN_ERROR", message: "Failed to obtain tokens" });
      }

      // Get user email
      oauth2Client.setCredentials(tokens);
      const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();
      const email = userInfo.data.email || "";

      // Store connection
      await storage.upsertConnection({
        websiteId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: tokens.expiry_date,
        scopes: tokens.scope?.split(" ") || REQUIRED_SCOPES,
        googleUserEmail: email,
        scProperty: null,
        ga4PropertyId: null,
      });

      // Redirect back to AI Doctor UI
      if (AI_DOCTOR_BASE_URL) {
        return res.redirect(`${AI_DOCTOR_BASE_URL}/integrations/google?website_id=${websiteId}&status=success`);
      }

      res.json({ 
        success: true, 
        message: "Google account connected successfully",
        websiteId,
        email,
      });
    } catch (error: any) {
      console.error("OAuth callback error:", error);
      
      if (AI_DOCTOR_BASE_URL) {
        return res.redirect(`${AI_DOCTOR_BASE_URL}/integrations/google?status=error&message=${encodeURIComponent(error.message)}`);
      }
      
      res.status(500).json({ error: "CALLBACK_ERROR", message: error.message });
    }
  });

  // Protected API routes
  app.get("/api/websites/:websiteId/status", requireAuth, async (req, res) => {
    try {
      const { websiteId } = req.params;
      const connection = await storage.getConnection(websiteId);

      if (!connection) {
        return res.json({
          connected: false,
          scopes: [],
          scProperty: null,
          ga4PropertyId: null,
          googleUserEmail: null,
        });
      }

      res.json({
        connected: true,
        scopes: connection.scopes,
        scProperty: connection.scProperty,
        ga4PropertyId: connection.ga4PropertyId,
        googleUserEmail: connection.googleUserEmail,
        expiresAt: new Date(connection.expiryDate).toISOString(),
      });
    } catch (error: any) {
      res.status(500).json(handleGoogleAPIError(error));
    }
  });

  // Set Search Console property
  app.post("/api/websites/:websiteId/search-console/property", requireAuth, async (req, res) => {
    try {
      const { websiteId } = req.params;
      const schema = z.object({ property: z.string() });
      const { property } = schema.parse(req.body);

      const oauth2Client = await getAuthenticatedClient(websiteId);
      const searchconsole = google.searchconsole({ version: "v1", auth: oauth2Client });

      // Validate property by fetching sites list
      const sitesResponse = await retryWithBackoff(() => searchconsole.sites.list());
      const sites = sitesResponse.data.siteEntry || [];
      const validProperty = sites.find(site => site.siteUrl === property);

      if (!validProperty) {
        return res.status(400).json({ 
          error: "INVALID_PROPERTY", 
          message: "Property not found or not accessible",
          availableProperties: sites.map(s => s.siteUrl),
        });
      }

      await storage.updateScProperty(websiteId, property);

      res.json({ success: true, property });
    } catch (error: any) {
      console.error("Set SC property error:", error);
      res.status(500).json(handleGoogleAPIError(error));
    }
  });

  // Set GA4 property
  app.post("/api/websites/:websiteId/ga4/property", requireAuth, async (req, res) => {
    try {
      const { websiteId } = req.params;
      const schema = z.object({ propertyId: z.string() });
      const { propertyId } = schema.parse(req.body);

      const oauth2Client = await getAuthenticatedClient(websiteId);
      const analyticsdata = google.analyticsdata({ version: "v1beta", auth: oauth2Client });

      // Validate by running a test query
      await retryWithBackoff(() => 
        analyticsdata.properties.runReport({
          property: `properties/${propertyId}`,
          requestBody: {
            dateRanges: [{ startDate: "yesterday", endDate: "yesterday" }],
            metrics: [{ name: "sessions" }],
          },
        })
      );

      await storage.updateGa4Property(websiteId, propertyId);

      res.json({ success: true, propertyId });
    } catch (error: any) {
      console.error("Set GA4 property error:", error);
      res.status(500).json(handleGoogleAPIError(error));
    }
  });

  // Get Search Console summary
  app.get("/api/websites/:websiteId/search-console/summary", requireAuth, async (req, res) => {
    try {
      const { websiteId } = req.params;
      const { startDate = "30daysAgo", endDate = "yesterday" } = req.query;

      const connection = await storage.getConnection(websiteId);
      if (!connection?.scProperty) {
        return res.status(400).json({ error: "NO_PROPERTY", message: "Search Console property not configured" });
      }

      const oauth2Client = await getAuthenticatedClient(websiteId);
      const searchconsole = google.searchconsole({ version: "v1", auth: oauth2Client });

      const response = await retryWithBackoff(() =>
        searchconsole.searchanalytics.query({
          siteUrl: connection.scProperty!,
          requestBody: {
            startDate: startDate as string,
            endDate: endDate as string,
            dimensions: ["date"],
          },
        })
      );

      const rows = response.data.rows || [];
      
      const totals = {
        clicks: 0,
        impressions: 0,
        ctr: 0,
        position: 0,
      };

      const byDay = rows.map(row => ({
        date: row.keys?.[0] || "",
        clicks: row.clicks || 0,
        impressions: row.impressions || 0,
        ctr: row.ctr || 0,
        position: row.position || 0,
      }));

      // Calculate totals
      if (rows.length > 0) {
        totals.clicks = rows.reduce((sum, row) => sum + (row.clicks || 0), 0);
        totals.impressions = rows.reduce((sum, row) => sum + (row.impressions || 0), 0);
        totals.ctr = totals.clicks / (totals.impressions || 1);
        totals.position = rows.reduce((sum, row) => sum + (row.position || 0), 0) / rows.length;
      }

      res.json({ totals, byDay });
    } catch (error: any) {
      console.error("GSC summary error:", error);
      res.status(500).json(handleGoogleAPIError(error));
    }
  });

  // Get Search Console top queries or pages
  app.get("/api/websites/:websiteId/search-console/top", requireAuth, async (req, res) => {
    try {
      const { websiteId } = req.params;
      const { dimension = "query", startDate = "30daysAgo", endDate = "yesterday", limit = "10" } = req.query;

      if (dimension !== "query" && dimension !== "page") {
        return res.status(400).json({ error: "BAD_REQUEST", message: "dimension must be 'query' or 'page'" });
      }

      const connection = await storage.getConnection(websiteId);
      if (!connection?.scProperty) {
        return res.status(400).json({ error: "NO_PROPERTY", message: "Search Console property not configured" });
      }

      const oauth2Client = await getAuthenticatedClient(websiteId);
      const searchconsole = google.searchconsole({ version: "v1", auth: oauth2Client });

      const response = await retryWithBackoff(() =>
        searchconsole.searchanalytics.query({
          siteUrl: connection.scProperty!,
          requestBody: {
            startDate: startDate as string,
            endDate: endDate as string,
            dimensions: [dimension as string],
            rowLimit: parseInt(limit as string, 10),
          },
        })
      );

      const rows = response.data.rows || [];
      const items = rows.map(row => ({
        [dimension as string]: row.keys?.[0] || "",
        clicks: row.clicks || 0,
        impressions: row.impressions || 0,
        ctr: row.ctr || 0,
        position: row.position || 0,
      }));

      res.json({ dimension, items });
    } catch (error: any) {
      console.error("GSC top error:", error);
      res.status(500).json(handleGoogleAPIError(error));
    }
  });

  // Get GA4 summary
  app.get("/api/websites/:websiteId/ga4/summary", requireAuth, async (req, res) => {
    try {
      const { websiteId } = req.params;
      const { startDate = "30daysAgo", endDate = "yesterday" } = req.query;

      const connection = await storage.getConnection(websiteId);
      if (!connection?.ga4PropertyId) {
        return res.status(400).json({ error: "NO_PROPERTY", message: "GA4 property not configured" });
      }

      const oauth2Client = await getAuthenticatedClient(websiteId);
      const analyticsdata = google.analyticsdata({ version: "v1beta", auth: oauth2Client });

      const response = await retryWithBackoff(() =>
        analyticsdata.properties.runReport({
          property: `properties/${connection.ga4PropertyId}`,
          requestBody: {
            dateRanges: [{ startDate: startDate as string, endDate: endDate as string }],
            dimensions: [{ name: "date" }],
            metrics: [
              { name: "sessions" },
              { name: "totalUsers" },
              { name: "screenPageViews" },
              { name: "averageSessionDuration" },
              { name: "bounceRate" },
              { name: "conversions" },
            ],
          },
        })
      );

      const rows = response.data.rows || [];
      
      const totals = {
        sessions: 0,
        users: 0,
        pageViews: 0,
        avgSessionDuration: 0,
        bounceRate: 0,
        conversions: 0,
      };

      const byDay = rows.map(row => {
        const date = row.dimensionValues?.[0]?.value || "";
        const metrics = row.metricValues || [];
        return {
          date,
          sessions: parseInt(metrics[0]?.value || "0", 10),
          users: parseInt(metrics[1]?.value || "0", 10),
          pageViews: parseInt(metrics[2]?.value || "0", 10),
          avgSessionDuration: parseFloat(metrics[3]?.value || "0"),
          bounceRate: parseFloat(metrics[4]?.value || "0"),
          conversions: parseInt(metrics[5]?.value || "0", 10),
        };
      });

      // Calculate totals
      if (rows.length > 0) {
        totals.sessions = byDay.reduce((sum, day) => sum + day.sessions, 0);
        totals.users = byDay.reduce((sum, day) => sum + day.users, 0);
        totals.pageViews = byDay.reduce((sum, day) => sum + day.pageViews, 0);
        totals.avgSessionDuration = byDay.reduce((sum, day) => sum + day.avgSessionDuration, 0) / rows.length;
        totals.bounceRate = byDay.reduce((sum, day) => sum + day.bounceRate, 0) / rows.length;
        totals.conversions = byDay.reduce((sum, day) => sum + day.conversions, 0);
      }

      res.json({ totals, byDay });
    } catch (error: any) {
      console.error("GA4 summary error:", error);
      res.status(500).json(handleGoogleAPIError(error));
    }
  });

  // Get GA4 top landing pages
  app.get("/api/websites/:websiteId/ga4/top-landing-pages", requireAuth, async (req, res) => {
    try {
      const { websiteId } = req.params;
      const { startDate = "30daysAgo", endDate = "yesterday", limit = "10" } = req.query;

      const connection = await storage.getConnection(websiteId);
      if (!connection?.ga4PropertyId) {
        return res.status(400).json({ error: "NO_PROPERTY", message: "GA4 property not configured" });
      }

      const oauth2Client = await getAuthenticatedClient(websiteId);
      const analyticsdata = google.analyticsdata({ version: "v1beta", auth: oauth2Client });

      const limitNum = parseInt(limit as string, 10);
      
      const response = await retryWithBackoff(() =>
        analyticsdata.properties.runReport({
          property: `properties/${connection.ga4PropertyId}`,
          requestBody: {
            dateRanges: [{ startDate: startDate as string, endDate: endDate as string }],
            dimensions: [{ name: "landingPage" }],
            metrics: [
              { name: "sessions" },
              { name: "totalUsers" },
              { name: "screenPageViews" },
              { name: "conversions" },
            ],
            limit: limitNum.toString(),
            orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          },
        })
      );

      const rows = response.data.rows || [];
      const items = rows.map(row => {
        const landingPage = row.dimensionValues?.[0]?.value || "";
        const metrics = row.metricValues || [];
        return {
          landingPage,
          sessions: parseInt(metrics[0]?.value || "0", 10),
          users: parseInt(metrics[1]?.value || "0", 10),
          pageViews: parseInt(metrics[2]?.value || "0", 10),
          conversions: parseInt(metrics[3]?.value || "0", 10),
        };
      });

      res.json({ items });
    } catch (error: any) {
      console.error("GA4 top landing pages error:", error);
      res.status(500).json(handleGoogleAPIError(error));
    }
  });

  return httpServer;
}
