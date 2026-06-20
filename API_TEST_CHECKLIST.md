# Palmistry AI API Test Checklist

## 1. API Mode Test Setup

- Keep real API keys out of frontend files.
- Set `GEMINI_API_KEY` on the server or hosting environment.
- Optional: set `GEMINI_MODEL=gemini-3.5-flash`.
- Open normal mode first:
  - `/`
- Open API mode only after the server API is available:
  - `/?engine=api`

Expected engine labels:

- Normal file/browser mode: `브라우저 분석`
- API mode without server: `API는 서버 필요` or `브라우저 분석(대체)`
- API mode with Gemini success: `Gemini gemini-3.5-flash`

## 2. API Key Safety Check

- Real key is not written in `app.js`.
- Real key is not written in `index.html`.
- Real key is not committed in `.env`.
- `.env.example` contains only empty sample values.
- `.gitignore` excludes `.env` and local env files.

## 3. Functional Verification

- Open the app on phone-size screen.
- Tap left hand capture.
- Confirm camera/gallery sheet opens.
- Close sheet with cancel/backdrop/Escape.
- Select left hand image.
- Confirm left preview and quality label appear.
- Select right hand image.
- Confirm right preview and quality label appear.
- Confirm analyze button activates.
- Run normal analysis.
- Confirm result screen shows:
  - confidence score
  - image quality
  - analysis engine
  - Life/Head/Heart/Fate scores
  - insight text
- Test low-quality image.
- Confirm first tap warns before analysis.
- Confirm second tap allows reference analysis.
- Confirm low-quality result emphasizes `다시 촬영하기`.
- Create share card.
- Confirm `cyberpalm-share-card.png` downloads.

## 4. API Mode Verification

- Open `/?engine=api` from an HTTP/HTTPS server.
- Confirm capture screen engine chip shows API mode.
- Run analysis with two hand images.
- If Gemini succeeds:
  - result engine shows `Gemini ...`
  - scores and Korean insights appear.
- If Gemini fails:
  - app falls back to browser analysis.
  - result engine shows `브라우저 분석(대체)`.

## 5. Deployment Gate

Do not deploy until the app passes the functional verification above.
