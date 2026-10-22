# Learnxpw proxy site (Vercel)

- public/ : scraped page, files placed in the _next/static/... layout the HTML expects
- api/[...path].js : proxies every /api/* call to ORIGIN (default https://www.learnxpw.site)
- vercel.json : local files win; missing /_next/* (fonts, lazy chunks), /assets/*, and other pages fall back to the original site

Deploy: `vercel --prod` (or push to GitHub and import). Optional env var: ORIGIN.
