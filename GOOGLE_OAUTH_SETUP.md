# Google OAuth Setup Guide

Follow these steps to set up Google OAuth for your Helpy app:

## 1. Create a Google Cloud Project

- Go to [Google Cloud Console](https://console.cloud.google.com/)
- Create a new project or select an existing one

## 2. Set up OAuth Consent Screen

- Go to "APIs & Services" > "OAuth consent screen"
- Choose "External" user type and click "Create"
- Fill in the required app information
- Add your email as a test user if needed
- Save and continue through the steps

## 3. Create OAuth Credentials

- Go to "APIs & Services" > "Credentials"
- Click "Create Credentials" > "OAuth client ID"
- Select "Desktop app" as the application type
- Give it a name and click "Create"

## 4. Configure Redirect URI

- In the OAuth client settings, add this authorized redirect URI:
  `http://localhost:3456/auth/google/callback`

## 5. Update Environment Variables

- Copy the Client ID and Client secret
- Open your `.env` file in the Helpy project directory
- Update the values:
  ```
  GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
  GOOGLE_CLIENT_SECRET=your-client-secret
  GOOGLE_REDIRECT_URI=http://localhost:3456/auth/google/callback
  ```

## 6. Restart the App

- Restart Helpy to apply the changes
- You should now be able to sign in with Google!
