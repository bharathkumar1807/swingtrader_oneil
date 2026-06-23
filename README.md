# Swing Trader — O'Neil × Minervini System

React (Vite) + ASP.NET Core 8 + Alpaca API + SignalR + SQL Server

---

## Prerequisites

Install these before starting:

| Tool | Download |
|------|----------|
| .NET 8 SDK | https://dotnet.microsoft.com/download/dotnet/8.0 |
| Node.js 20+ | https://nodejs.org |
| SQL Server (Express free) | https://www.microsoft.com/en-us/sql-server/sql-server-downloads |
| SQL Server Management Studio | https://aka.ms/ssmsfullsetup |
| VS Code | https://code.visualstudio.com |

### VS Code Extensions to install
- C# Dev Kit (Microsoft)
- ESLint
- Prettier
- Thunder Client (API testing — like Postman)

---

## Step 1 — Get Alpaca API Keys (Free)

1. Go to https://alpaca.markets → Sign up free
2. Dashboard → Paper Trading → API Keys → Generate
3. Copy **API Key** and **Secret Key**
4. Paste them into `backend/SwingTrader.API/appsettings.json`:

```json
"Alpaca": {
  "ApiKey": "PASTE_YOUR_API_KEY",
  "SecretKey": "PASTE_YOUR_SECRET_KEY",
  "IsPaper": true
}
```

---

## Step 2 — Set Up Database

Open SQL Server Management Studio → Connect to `localhost` → New Query:

```sql
CREATE DATABASE SwingTraderDB;
```

The connection string in `appsettings.json` is already set to use Windows Authentication:
```
Server=localhost;Database=SwingTraderDB;Trusted_Connection=True;TrustServerCertificate=True;
```

---

## Step 3 — Run the Backend

Open terminal in VS Code (`Ctrl + ~`):

```bash
# Navigate to backend
cd backend/SwingTrader.API

# Restore NuGet packages
dotnet restore

# Run (auto-creates tables via EnsureCreated)
dotnet run
```

Backend runs at: **http://localhost:5000**
Swagger UI: **http://localhost:5000/swagger**
Hangfire Dashboard: **http://localhost:5000/hangfire**

---

## Step 4 — Run the Frontend

Open a **second terminal** in VS Code:

```bash
# Navigate to frontend
cd frontend

# Install npm packages
npm install

# Start dev server
npm run dev
```

Frontend runs at: **http://localhost:5173**

---

## Step 5 — Open in VS Code

```bash
# From the SwingTrader root folder
code .
```

VS Code will open the whole project. You'll see:
```
SwingTrader/
├── backend/   ← C# .NET 8 project
└── frontend/  ← React Vite project
```

---

## Project Structure

```
SwingTrader/
├── backend/SwingTrader.API/
│   ├── Controllers/
│   │   └── Controllers.cs         ← All API endpoints
│   ├── Data/
│   │   └── AppDbContext.cs        ← EF Core DB context
│   ├── Hubs/
│   │   └── PriceHub.cs            ← SignalR real-time hub
│   ├── Models/
│   │   └── Models.cs              ← All DB models
│   ├── Services/
│   │   ├── AlpacaStreamService.cs ← WebSocket price stream
│   │   ├── AlpacaDataService.cs   ← REST data + MA calculations
│   │   ├── TradeService.cs        ← Trade setup + position sizing
│   │   └── OtherServices.cs       ← Screener, Journal, Yahoo Finance
│   ├── Program.cs                 ← App startup + DI
│   └── appsettings.json           ← Config (put your API keys here)
│
└── frontend/src/
    ├── pages/
    │   ├── Dashboard.tsx          ← Open positions + market direction
    │   ├── Screener.tsx           ← Daily scan results (stub)
    │   ├── Watchlist.tsx          ← Shortlisted stocks (stub)
    │   ├── EntryPlanner.tsx       ← Live price + position sizing ✓
    │   ├── Positions.tsx          ← Active trades (stub)
    │   ├── Journal.tsx            ← Closed trades (stub)
    │   └── Analytics.tsx          ← Win rate, equity curve (stub)
    ├── services/
    │   └── api.ts                 ← All Axios API calls
    ├── hooks/
    │   └── useSignalR.ts          ← SignalR connection hook
    ├── store/
    │   └── useStore.ts            ← Zustand global state
    └── App.tsx                    ← Router + sidebar layout
```

---

## What's Working Out of the Box

| Feature | Status |
|---------|--------|
| Backend API (all controllers) | ✓ Ready |
| SQL Server + EF Core (auto-migrate) | ✓ Ready |
| SignalR hub wired up | ✓ Ready |
| Alpaca WebSocket stream service | ✓ Ready |
| Alpaca REST (bars, snapshots, MAs) | ✓ Ready |
| Minervini template checker | ✓ Ready |
| Position size calculator | ✓ Ready |
| Trade setup creation | ✓ Ready |
| Entry Planner page (live price) | ✓ Ready |
| Dashboard (positions + stats) | ✓ Ready |
| Hangfire background jobs | ✓ Ready |
| Screener, Watchlist, Journal, Analytics pages | Stub — build next |

---

## Build Order (Recommended)

1. Get backend running + Swagger shows endpoints ✓
2. Test Entry Planner — enter AAPL, see live price
3. Create a trade setup → check DB in SSMS
4. Build out Watchlist page — add symbols, see live prices
5. Build out Positions page — live P&L via SignalR
6. Build out Journal page — close trades, add notes/grade
7. Build out Analytics page — charts with Recharts
8. Build out Screener page — hook up daily scan results

---

## Useful Commands

```bash
# Add EF Core migration (after changing models)
cd backend/SwingTrader.API
dotnet ef migrations add MigrationName
dotnet ef database update

# Install new NuGet package
dotnet add package PackageName

# Install new npm package
cd frontend
npm install package-name
```

---

## Alpaca API Docs
https://docs.alpaca.markets/reference/getallassets

## SignalR Docs
https://learn.microsoft.com/en-us/aspnet/core/signalr/introduction
