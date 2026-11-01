# KrishiMitra 2.0 — Smart Farmer Weather & SMS Alert System

This is an upgraded version of the uploaded KrishiMitra website. The original landing page, language switcher, farmer dashboard, leaf-photo demo, crop checklist, mandi section and local history are retained. New features use a Node.js backend so alerts continue even when a farmer is not visiting the website.

## Backend files (kept separate for easier editing)

- `server/index.js` — starts Express and contains farmer registration, weather, crop calendar, market API and scheduled SMS.
- `server/lib/store.js` — reads/writes JSON data files safely.
- `server/routes/history.js` — REST API for user-specific search history.
- `data/farmers.json` — registered farmer profiles and generated user IDs.
- `data/history.json` — persistent search history linked to each generated user ID.
- `.env.example` — environment variable template; copy it to `.env`.

Each farmer receives a generated UUID as their `userId`. History is stored on the server and can be restored when they log in again from the same profile details. **Important:** this prototype does not yet use OTP/password authentication. Before public deployment, add OTP verification and rate limiting so knowing a mobile number and ID is not treated as secure identity verification.

## New features included

1. **7-day local weather forecast** — farmer enters village/district/city; backend geocodes it and fetches a 7-day forecast from Open-Meteo.
2. **Automatic weather SMS** — scheduled daily at 7:00 AM India time. SMS includes the next seven days' min/max temperature and rain probability.
3. **Crop sowing-season SMS** — an indicative crop calendar sends one SMS when the selected crop's sowing window is active. Calendar currently includes wheat, paddy, maize, cotton, mustard and vegetables. Update `server/index.js` with district/variety-specific recommendations approved by PAU/KVK before production.
4. **Last 12-month top 3 crop varieties** — fetches Agmarknet records from data.gov.in and ranks varieties by average recorded modal price; shows average modal price in INR/quintal. Requires a data.gov.in API key. It does not fabricate prices if the API is not configured.
5. **SMS consent** — the farmer must tick the SMS consent box before the server registers the farmer for automated alerts.

## A. Install and run on your computer

1. Install **Node.js 18 or newer** from https://nodejs.org/.
2. Extract this ZIP to a folder, for example `KrishiMitra`.
3. Open that folder in VS Code.
4. Open VS Code Terminal → New Terminal.
5. Run:

   ```bash
   npm install
   ```

6. Copy `.env.example` to a new file named `.env` in the project root.
7. Add your API credentials to `.env` (see below).
8. Start the website and backend:

   ```bash
   npm start
   ```

9. Open **http://localhost:3000** in Chrome. Do not open `index.html` by double-clicking; API requests need the Node server.

## B. Configure automatic SMS (Twilio)

1. Create a Twilio account at https://www.twilio.com/ and obtain an Account SID, Auth Token and an SMS-capable Twilio sender number.
2. Add these values to `.env`:

   ```env
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your_secret_token
   TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
   ALERT_TIMEZONE=Asia/Kolkata
   ```

3. Keep `.env` private. Never put Twilio credentials in `script.js`, `index.html`, GitHub, or a public repository.
4. Open the site, enter farmer name, 10-digit Indian mobile number, state, village/district/city and main crop. Tick the SMS consent checkbox and save.
5. The farmer must be registered once while online. After that, the farmer does **not** need to revisit the site for scheduled SMS. The backend server must remain running 24/7 on a hosting service.
6. SMS is sent from the Twilio sender number. Twilio account country, recipient verification, sender registration, Indian DLT/template rules and delivery permissions may apply. Configure compliant templates/sender IDs with your provider before real use.

## C. Configure historical mandi prices

1. Register at https://data.gov.in/ and create an API key.
2. Put it in `.env`:

   ```env
   DATA_GOV_API_KEY=your_data_gov_in_api_key
   ```

3. Restart the server.
4. In the website's Market Prices section, choose crop and state and click **Load last-year variety prices**.
5. The table displays the top three varieties by average modal price, their average modal price, source and record count. Actual availability depends on the dataset fields and coverage returned by data.gov.in. If there are no records, it displays that instead of inventing prices.

## D. Where to change each feature

| Feature | Code location |
|---|---|
| Website layout and farmer fields | `index.html` |
| Design / responsive layout | `style.css` |
| Browser interactions and API calls | `script.js` |
| Generated farmer User ID | `server/index.js` (registration endpoint) |
| Persistent search history API | `server/routes/history.js` |
| JSON data storage | `server/lib/store.js`, `data/farmers.json`, `data/history.json` |
| Weather API, geocoding, farmer registration | `server/index.js` (`/api/weather`, `/api/farmers`) |
| Daily 7-day weather SMS schedule | `server/index.js` (`runDailyAlerts`, cron schedule near bottom) |
| Crop sowing windows and SMS text | `server/index.js` (`cropCalendar`) |
| Historical mandi variety prices | `server/index.js` (`/api/market/last-year`) |
| Secrets and service configuration | `.env` (copy from `.env.example`) |

## E. Test the backend

- Visit `http://localhost:3000/api/health` to check server status and whether SMS / historical API credentials are configured.
- Save a farmer profile through the website. A village/district/city must be entered so the weather location can be resolved.
- The 7-day forecast appears in the weather panel.
- The scheduler runs at 07:00 Asia/Kolkata. For a manual test, send `POST http://localhost:3000/api/admin/run-alerts` using an API client such as Postman. Do not expose this test endpoint publicly without adding authentication or removing it after testing.

## Important production requirements / limitations

- This project is a functional starter, **not yet a production-certified agricultural advisory service**. Sowing dates in the included calendar are broad indicative windows. They must be reviewed and adapted to the farmer's district, irrigation, variety and current PAU/KVK recommendations.
- Open-Meteo is used for forecast data. Forecasts are not guarantees; avoid automatic pesticide/spraying instructions based only on rain probability.
- The data.gov.in Agmarknet resource may change its available fields, date formats or filters. Verify the current resource schema and terms before launch. The code intentionally shows an error rather than fake market prices if the service is unavailable.
- The starter stores farmer records in `data/farmers.json`. For a public production service, replace this with a secure database (PostgreSQL/Firebase/Supabase), encrypt personal data, add admin authentication, access controls, rate limits, backups, consent withdrawal and a privacy policy.
- Use a process manager/managed hosting (Render, Railway, VPS, etc.) with a persistent always-on worker. If the server sleeps, cron alerts will not run. Set `BASE_URL` to the deployed HTTPS domain.
- The website must be hosted over HTTPS for public use. Obtain explicit consent, comply with India's applicable privacy, telecom, SMS DLT and anti-spam requirements, and provide an unsubscribe/STOP workflow before sending real messages.
- Existing leaf photo analysis remains a demo checklist, not an AI disease diagnosis.

## Original project

The original project files were retained and extended: `index.html`, `style.css`, `script.js`, and the original farmer-facing sections remain part of this ZIP.


## User ID and history API quick reference

- `POST /api/farmers` — register/update a farmer; response includes `farmer.id` (the generated User ID).
- `GET /api/history/:userId?mobile=10_DIGIT_MOBILE` — retrieve that farmer's recent history.
- `POST /api/history` — JSON body: `{ "userId": "...", "mobile": "9876543210", "type": "Weather", "detail": "7-day forecast for Patiala" }`.
- `DELETE /api/history/:userId?mobile=10_DIGIT_MOBILE` — clear that farmer's history.
- `GET /api/health` — server and optional API configuration status.

History is capped at 100 entries per farmer. User ID is an identifier, not a password; do not expose personal data publicly until OTP-based authentication and authorization are implemented.


## OTP registration and returning farmer login (prototype)

- New farmer: enter mobile number -> Send OTP -> verify OTP -> complete profile -> accept SMS consent if desired -> Save farmer profile.
- Returning farmer: use **Already registered? Login here**, enter the registered name and mobile number -> Send OTP -> verify OTP. The server checks `data/farmers.json`; matching records open the profile, otherwise it returns **Invalid user**.
- If Twilio credentials are configured, OTPs are sent as SMS using the configured Twilio number. If not configured, this local hackathon prototype displays a demo OTP on-screen and logs it in the server terminal. Do not deploy demo OTP mode publicly.
- OTPs expire after five minutes and allow up to five verification attempts. This in-memory implementation resets when the server restarts and needs rate limiting, persistent storage and a proper authentication/session system before production.
- Leaf scan output is preliminary symptom guidance; it does not infer a confirmed disease from image pixels. Do not choose pesticide or dose without crop-specific diagnosis and local expert/label guidance.
