# Mobile release checklist

Blocked on HOLD H-03 (store accounts and final app identity). Everything below is ready to run once those exist. Expo Go is **development only**; it cannot ship to users. Public builds go through EAS.

## Configuration map

- `artifacts/system-self/app.json` is the static base (version 1.0.0, iOS `buildNumber` "1", Android `versionCode` 1, permissions, privacy manifest, plugins).
- `artifacts/system-self/app.config.ts` layers env values on top:
  - `APP_ID` sets iOS `bundleIdentifier` and Android `package` (default placeholder `com.systemself.app`).
  - `EAS_PROJECT_ID` sets `extra.eas.projectId` (omitted when unset; the app skips push registration without it).
  - `GOOGLE_SERVICES_JSON` sets `android.googleServicesFile` (needed for FCM).
- `artifacts/system-self/eas.json` defines `development` (dev client, internal), `preview` (internal, APK) and `production` (auto-increment, AAB). Each profile sets `EXPO_PUBLIC_API_URL`; the values are placeholders, replace them with the real API URLs. `submit.production` holds placeholder Apple IDs (H-03).
- Purchases keys: `EXPO_PUBLIC_REVENUECAT_IOS_KEY` and `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`. Set them per profile as EAS env vars, not in git.
- Android permissions requested: `INTERNET`, `RECORD_AUDIO` (voice), `POST_NOTIFICATIONS`, `VIBRATE`, `MODIFY_AUDIO_SETTINGS` (expo-audio). Storage, media, location, camera and overlay permissions are explicitly blocked.
- iOS privacy manifest declares UserDefaults (`CA92.1`), file timestamp (`C617.1`), system boot time (`35F9.1`) and disk space (`E174.1`). `ITSAppUsesNonExemptEncryption` is false (standard HTTPS only).

## One-time setup

1. `cd artifacts/system-self && pnpm exec eas login`
2. `pnpm exec eas init` creates the EAS project and prints a project id. Set it as `EAS_PROJECT_ID` (EAS env var for each profile).
3. Choose the real bundle id / package and set `APP_ID` the same way. It cannot change after the first store upload.
4. Android push (FCM): create a Firebase project, add an Android app with the package name, download `google-services.json`, and upload it as an EAS file env var named `GOOGLE_SERVICES_JSON` (`eas env:create --type file`). Upload the FCM service account key under `eas credentials` for Android.
5. iOS push (APNs): `pnpm exec eas credentials` and let EAS create the APNs key.
6. RevenueCat: create the iOS and Android apps, copy the public SDK keys into the env vars above.
   - Products: `system_self_pro_monthly` and `system_self_pro_annual`.
   - Entitlement: `pro`, attached to both products.
   - Point the webhook at the API's RevenueCat webhook route with the shared secret (see docs/DEPLOYMENT.md).
7. Fill the `submit.production` placeholders in `eas.json` (Apple ID, App Store Connect app id) and add a Play service account key.

## Build and submit

```
cd artifacts/system-self
pnpm exec eas build --profile development --platform all   # dev client
pnpm exec eas build --profile preview --platform android   # internal APK
pnpm exec eas build --profile production --platform all    # store builds
pnpm exec eas submit --profile production --platform ios
pnpm exec eas submit --profile production --platform android
```

## Store listing checklist

- [ ] Screenshots: iOS 6.9" and 6.5" iPhone sets; Android phone screenshots (min 2). Cover Home, Quests, Rank, Gym, Clan.
- [ ] Google Play feature graphic (1024x500) and 512x512 icon.
- [ ] App Store 1024x1024 icon without alpha, and optional promotional art.
- [ ] Short and full description, support URL, marketing URL.
- [ ] Privacy policy URL (publish `docs/legal/privacy.md`) and terms URL (`docs/legal/terms.md`).

### Privacy nutrition labels (App Store) and Data safety (Play)

Mapped from `docs/legal/privacy.md` section 3. Nothing is used for tracking or advertising, and data is not sold.

| Collected | Apple category | Play category | Linked to user | Purpose |
|---|---|---|---|---|
| Email, username, birth year | Contact Info | Personal info | Yes | Account, app functionality |
| Logs, quests, finance entries, gym data, free text | User Content, Health and Fitness, Financial Info | Health and fitness, Financial info, App activity | Yes | App functionality, personalisation |
| Follows, clan membership and messages, duo, peer ratings | User Content | Messages, App activity | Yes | App functionality |
| Push tokens, device user agent | Device ID | Device or other IDs | Yes | Notifications, security |
| Purchase status and billing events (no card data) | Purchases | Purchase history | Yes | Subscription verification |
| Server request logs (IP, user agent, request id) | Other Diagnostic Data | App info and performance | Yes | Security, debugging |
| Usage analytics events | Product Interaction | App activity | Yes | Analytics |
| Voice input (microphone, press and hold) | Audio Data (not retained) | Voice or sound recordings (not retained) | Yes | Not retained: sent to Google Gemini for transcription only |

Also state: data is encrypted in transit, users can delete their account (below), and AI features send a game-state summary to Google Gemini. Not collected: contacts, precise location, advertising identifiers.

### Age rating

- Target audience 16+ (sign-up enforces it with a birth year, per the privacy policy).
- Answer the questionnaires with no objectionable content (no violence, sexual content or gambling). Expect Teen on Google Play (IARC) and 12+ on the App Store; if the store allows it, choose a higher bracket to match 16+.
- Declare user-generated content (clan messages; reporting and blocking exist) and in-app purchases.

### Account deletion

- In app: Settings, Account, Delete account (password confirm, `DELETE /api/auth/account`). Apple and Play both require this.
- Both stores also need a web URL: **PLACEHOLDER** `https://systemself.app/delete-account`. Publish a page explaining in-app deletion plus a support email for people who cannot sign in, then enter it in Play Console (Data safety) and App Store Connect.

### Review notes and demo account

1. Register a normal account in the app (for example `reviewer@systemself.app`) and finish onboarding.
2. Grant PRO as an admin (`role = "admin"`): `POST /api/admin/users/:id/entitlement` with body `{"tier":"pro"}` (omit `expiresAt` for no expiry). Find the user id with `GET /api/admin/users`.
3. Put the credentials, a short description of the game loop and where the PRO features are into App Store Connect "App Review Information" and Play Console "App access".
4. Tell reviewers that bonus quests have no rank effect.
5. Mention that purchases use RevenueCat with sandbox accounts and that voice input needs the microphone permission.

## Before submitting

- [ ] `EXPO_PUBLIC_API_URL` is the real HTTPS API in the `production` profile.
- [ ] `pnpm --filter @workspace/system-self typecheck` and `test` pass.
- [ ] A preview build on a real device: sign-up, push received, sandbox purchase, account deletion.
