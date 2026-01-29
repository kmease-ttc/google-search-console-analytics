# AI Doctor Google Connector

## Overview

This is a multi-tenant OAuth connector service that enables secure integration with Google Search Console and Google Analytics 4 (GA4) Data API. The service handles OAuth 2.0 authentication flows, secure token storage with automatic refresh, and provides API endpoints for fetching search analytics and GA4 data on behalf of connected websites.

The application serves as a backend connector that AI Doctor (a separate application) uses to access Google services. Each website gets its own OAuth connection, enabling multi-tenant access to Google APIs.

## Recent Changes

**December 20, 2025** - Initial implementation complete
- Database schema created with `google_connections` table for multi-tenant token storage
- OAuth 2.0 flow implemented with signed JWT state to prevent CSRF
- Automatic token refresh with 5-minute expiry buffer
- All API endpoints implemented with JWT authentication
- Retry logic with exponential backoff for Google API calls
- Landing page with setup instructions created
- Error handling with structured error codes

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **Styling**: Tailwind CSS v4 with shadcn/ui component library (New York style)
- **Build Tool**: Vite with custom plugins for Replit integration

The frontend is minimal - serves as a landing/documentation page explaining setup. The main functionality is API-driven for machine-to-machine communication.

### Backend Architecture
- **Runtime**: Node.js 20 with Express
- **Language**: TypeScript with ESM modules
- **Authentication**: JWT-based (HS256) for service-to-service auth between AI Doctor and this connector
- **Google OAuth**: googleapis library for OAuth 2.0 flow and API access
- **Database**: PostgreSQL with Drizzle ORM

Key design patterns:
- OAuth state passed via signed JWT to prevent CSRF attacks
- Automatic token refresh when tokens expire (with 5-minute buffer)
- Retry with exponential backoff for Google API calls (handles 429, 5xx errors)
- Centralized error handling for Google API errors with structured error codes

### Data Storage
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema**: Single table `google_connections` storing OAuth tokens per website
- **Token Storage**: Access tokens, refresh tokens, expiry timestamps, and selected properties (Search Console, GA4)

Schema fields:
- `websiteId` (primary key) - Unique identifier for each website
- `accessToken` - Google OAuth access token
- `refreshToken` - Google OAuth refresh token for long-lived access
- `expiryDate` - Unix timestamp in ms
- `scopes` - Array of granted OAuth scopes
- `scProperty` - Selected Search Console property URL
- `ga4PropertyId` - Selected GA4 property ID
- `googleUserEmail` - Email of connected Google account
- `createdAt`, `updatedAt` - Timestamps

### API Structure

**Public Endpoints:**
- `GET /health` - Health check endpoint
- `GET /auth/start?website_id=X` - Initiates OAuth flow with signed state
- `GET /auth/callback` - OAuth callback handler, exchanges code for tokens

**Protected Endpoints** (require `Authorization: Bearer <JWT>` header):
- `GET /api/websites/:websiteId/status` - Connection status and configuration
- `POST /api/websites/:websiteId/search-console/property` - Set Search Console property (validates via sites.list)
- `POST /api/websites/:websiteId/ga4/property` - Set GA4 property (validates via test query)
- `GET /api/websites/:websiteId/search-console/summary` - GSC metrics by date (totals + byDay)
- `GET /api/websites/:websiteId/search-console/top` - Top queries or pages
- `GET /api/websites/:websiteId/ga4/summary` - GA4 metrics by date (totals + byDay)
- `GET /api/websites/:websiteId/ga4/top-landing-pages` - Top landing pages by sessions

### Security Model
- JWT shared secret between this connector and AI Doctor main app
- OAuth tokens stored in PostgreSQL database
- Refresh tokens used to maintain long-lived access
- Automatic token refresh prevents expired token errors
- Scopes requested: `webmasters.readonly`, `analytics.readonly`, `openid`, `email`

### Error Codes
- `NOT_CONNECTED` - No Google connection found for website
- `INSUFFICIENT_SCOPE` - Missing required OAuth permissions
- `RATE_LIMITED` - Google API rate limit exceeded
- `INVALID_PROPERTY` - Invalid or inaccessible property ID
- `NO_PROPERTY` - Property not configured for website
- `UNAUTHORIZED` - Missing or invalid JWT token
- `GOOGLE_API_ERROR` - Generic Google API error

## External Dependencies

### Google Cloud APIs
- **Google Search Console API** - For search analytics data
- **Google Analytics Data API (GA4)** - For analytics metrics
- **Google OAuth 2.0** - For authentication flow

Required environment variables:
- `GOOGLE_CLIENT_ID` - OAuth client ID from Google Cloud Console
- `GOOGLE_CLIENT_SECRET` - OAuth client secret
- `GOOGLE_REDIRECT_URI` - Callback URL (e.g., `https://your-app.repl.co/auth/callback`)

### Database
- **PostgreSQL** - Primary data store via `DATABASE_URL` environment variable
- Uses Drizzle Kit for schema management (`npm run db:push`)

### Service Integration
- `JWT_SHARED_SECRET` - Shared secret for JWT signing/verification with AI Doctor (HS256 algorithm)
- `AI_DOCTOR_BASE_URL` - Optional, for redirects back to main application after OAuth

### Key npm Dependencies
- `googleapis` - Google API client library
- `jsonwebtoken` - JWT handling for authentication
- `drizzle-orm` / `drizzle-zod` - Database ORM and validation
- `express` - HTTP server
- `pg` - PostgreSQL client
- `zod` - Schema validation

## Setup Instructions

1. **Google Cloud Console Setup:**
   - Create a project in Google Cloud Console
   - Enable Search Console API and Google Analytics Data API
   - Create OAuth 2.0 credentials (Web application type)
   - Add authorized redirect URI: `https://your-app.repl.co/auth/callback`

2. **Configure Replit Secrets:**
   - `GOOGLE_CLIENT_ID` - From Google Cloud Console
   - `GOOGLE_CLIENT_SECRET` - From Google Cloud Console
   - `GOOGLE_REDIRECT_URI` - Your callback URL
   - `JWT_SHARED_SECRET` - Secure random string shared with AI Doctor
   - `DATABASE_URL` - Automatically configured by Replit
   - `AI_DOCTOR_BASE_URL` - (Optional) Base URL of AI Doctor UI for post-OAuth redirects

3. **Deploy:**
   - Push database schema: `npm run db:push`
   - Start server: `npm run dev`
   - Test health endpoint: `GET /health`

## Usage Flow

1. AI Doctor initiates OAuth by redirecting user to `/auth/start?website_id=SITE_ID`
2. User completes Google OAuth consent flow
3. Service receives callback at `/auth/callback`, stores tokens in database
4. Service redirects back to AI Doctor UI (if AI_DOCTOR_BASE_URL is set)
5. AI Doctor makes authenticated API calls with JWT token to fetch data
6. Service automatically refreshes Google tokens when needed (5-minute buffer before expiry)
7. Service retries failed API calls with exponential backoff for rate limits and server errors
