# Google Auth Implementation

This document describes the Google OAuth authentication system that has replaced the previous Magic SDK authentication.

## Overview

The authentication system has been completely refactored to use Google OAuth 2.0 for user authentication and account creation. This provides a more secure and user-friendly authentication experience.

## Backend Changes

### Dependencies
- **Removed**: `bcryptjs`, `magic-sdk`
- **Added**: `google-auth-library`

### New Authentication Flow
1. Frontend receives Google ID token from Google Sign-In
2. Backend verifies the token with Google's servers
3. User is created or retrieved from database
4. JWT token is issued for session management

### API Endpoints
- **Removed**: `/signup`, `/login`
- **Added**: `/google-auth` - Handles Google OAuth token verification
- **Updated**: `/auth` - Enhanced token validation and user data retrieval

### Database Schema Changes
- **Removed**: `password` field, `HandleIndex`
- **Added**: `googleId` field, `GoogleIdIndex`
- **Added**: `name`, `picture` fields for Google profile data

## Frontend Changes

### Dependencies
- **Removed**: `magic-sdk`
- **Added**: Google Identity Services (loaded via CDN)

### Authentication Components
- **Login Component**: Completely rewritten to use Google Sign-In button
- **Auth Service**: Updated to use new token storage key and enhanced methods
- **App Component**: Re-enabled authentication flow

### Environment Variables
- **Removed**: `VITE_MAGIC_API_KEY`
- **Added**: `VITE_GOOGLE_CLIENT_ID`

## Setup Instructions

### 1. Google Cloud Console Setup
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add authorized domains for your application

### 2. Backend Configuration
1. Update `backend/secrets.json` with your Google Client ID:
```json
{
  "JWT_SECRET": "your-jwt-secret",
  "GOOGLE_CLIENT_ID": "your-google-client-id.googleusercontent.com"
}
```

### 3. Frontend Configuration
1. Update `frontend/.env` with your Google Client ID:
```
VITE_GOOGLE_CLIENT_ID=your-google-client-id.googleusercontent.com
```

### 4. Database Migration
The database schema has been updated to support Google authentication. Deploy the updated schema using:
```bash
cd backend
serverless deploy
```

## Security Improvements

1. **No Password Storage**: Eliminates password-related security risks
2. **Google Token Verification**: Tokens are verified server-side with Google
3. **Enhanced JWT**: Includes user email and ID for better session management
4. **Secure Token Storage**: Uses dedicated storage key for auth tokens

## User Experience

1. **One-Click Sign In**: Users can sign in with their Google account
2. **Automatic Account Creation**: New users are automatically created on first sign-in
3. **Profile Integration**: User's Google profile information is stored and available
4. **Seamless Sessions**: JWT tokens provide secure session management

## Migration Notes

- Existing users with Magic SDK accounts will need to sign in again with Google
- User data structure has changed to accommodate Google profile information
- Authentication flow is now completely handled by Google's secure infrastructure
