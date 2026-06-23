using SwingTrader.API.Data;
using SwingTrader.API.Models;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using Alpaca.Markets;

namespace SwingTrader.API.Services;

// ─── Stock Screener ───────────────────────────────────────────
public class StockScreenerService
{
    private readonly AppDbContext _db;
    private readonly AlpacaDataService _alpaca;
    private readonly TelegramService _telegram;
    private readonly ILogger<StockScreenerService> _logger;

    public StockScreenerService(AppDbContext db, AlpacaDataService alpaca,
        TelegramService telegram, ILogger<StockScreenerService> logger)
    {
        _db = db;
        _alpaca = alpaca;
        _telegram = telegram;
        _logger = logger;
    }

    // Called by Hangfire every morning at 6:30 AM ET
    public async Task RunDailyScreener()
    {
        _logger.LogInformation("Running daily screener scan...");

        var stocks = await _db.Stocks.ToListAsync();
        var results = new List<ScreenerResult>();

        foreach (var stock in stocks)
        {
            try
            {
                var ma = await _alpaca.CheckMinerviniTemplateAsync(stock.Symbol);
                var canslimScore = CalculateCanslimScore(stock);

                if (canslimScore >= 4 || ma.Score >= 5)
                {
                    results.Add(new ScreenerResult
                    {
                        Symbol = stock.Symbol,
                        CanslimScore = canslimScore,
                        MinerviniScore = ma.Score,
                        RsRating = stock.RsRating ?? 0,
                        EpsGrowth = stock.EpsGrowthQoQ ?? 0,
                        Sector = stock.Sector,
                        ScanDate = DateTime.UtcNow
                    });
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Screener error for {Symbol}", stock.Symbol);
            }
            await Task.Delay(350); // Alpaca free tier ~200 req/min → 300ms min; 350ms gives headroom
        }

        var today = DateTime.UtcNow.Date;
        var existing = await _db.ScreenerResults.Where(r => r.ScanDate.Date == today).ToListAsync();
        _db.ScreenerResults.RemoveRange(existing);
        _db.ScreenerResults.AddRange(results);
        await _db.SaveChangesAsync();
        _logger.LogInformation("Screener complete. {Count} stocks passed.", results.Count);

        await BroadcastTopPicksAsync(results);
        await AutoPromoteToPlansAsync(results);
    }

    private async Task BroadcastTopPicksAsync(List<ScreenerResult> results)
    {
        var top = results
            .OrderByDescending(r => r.MinerviniScore)
            .ThenByDescending(r => r.RsRating)
            .Take(10)
            .ToList();

        if (top.Count == 0) return;

        var today = DateTime.UtcNow;
        var sb = new System.Text.StringBuilder();
        sb.AppendLine($"📊 <b>TODAY'S TOP PICKS — {today:ddd dd MMM yyyy}</b>");
        sb.AppendLine("━━━━━━━━━━━━━━━━━━━━━━");
        foreach (var p in top)
        {
            var totalScore = p.MinerviniScore + p.CanslimScore;
            sb.AppendLine();
            sb.AppendLine($"<b>{p.Symbol}</b>  |  Score <b>{totalScore}/11</b>  |  RS <b>{p.RsRating:F0}</b>");
            sb.AppendLine($"   Minervini {p.MinerviniScore}/7  ·  CANSLIM {p.CanslimScore}/4  ·  EPS {(p.EpsGrowth >= 0 ? "+" : "")}{p.EpsGrowth:F0}%");
            if (!string.IsNullOrWhiteSpace(p.Sector))
                sb.AppendLine($"   📂 {p.Sector}");
        }
        sb.AppendLine();
        sb.AppendLine("Send /picks anytime to get this list again.");

        await _telegram.SendMessageAsync(sb.ToString());
        _logger.LogInformation("Broadcast top {Count} picks to all subscribers.", top.Count);
    }

    // Top screener picks → TradeSetups so the 9:30 AM Telegram summary can send them
    private async Task AutoPromoteToPlansAsync(List<ScreenerResult> results)
    {
        // Only promote high-confidence picks: Minervini >= 6 AND CANSLIM >= 3
        var topPicks = results
            .Where(r => r.MinerviniScore >= 6 && r.CanslimScore >= 3)
            .OrderByDescending(r => r.MinerviniScore + r.CanslimScore)
            .ThenByDescending(r => r.RsRating)
            .Take(10)
            .ToList();

        if (topPicks.Count == 0)
        {
            _logger.LogInformation("No picks met promotion threshold today.");
            return;
        }

        // Symbols already planned or active — don't duplicate
        var existingSymbols = await _db.TradeSetups
            .Where(t => t.Status == "Planned" || t.Status == "Active")
            .Select(t => t.Symbol)
            .ToListAsync();
        var existingSet = existingSymbols.ToHashSet();

        int promoted = 0;
        foreach (var pick in topPicks)
        {
            if (existingSet.Contains(pick.Symbol)) continue;

            // Fetch live price to calculate entry, stop, targets
            var suggest = await _alpaca.GetAutoSuggestAsync(pick.Symbol);
            if (suggest.SuggestedEntry <= 0 || suggest.SuggestedStop <= 0) continue;
            if (!suggest.IsValidRisk) continue;   // skip if risk > 8%

            var risk = suggest.SuggestedEntry - suggest.SuggestedStop;

            _db.TradeSetups.Add(new TradeSetup
            {
                Symbol         = pick.Symbol,
                Pattern        = "Screener Pick",
                EntryPrice     = suggest.SuggestedEntry,
                StopLoss       = suggest.SuggestedStop,
                Target1R       = suggest.SuggestedEntry + risk,
                Target20Pct    = suggest.SuggestedEntry * 1.20m,
                Target3R       = suggest.SuggestedEntry + (risk * 3),
                Shares         = 0,        // position sizing requires account size — set in app
                PositionSize   = 0,
                AccountSize    = 0,
                RiskPercent    = 1,
                CanslimScore   = pick.CanslimScore,
                MinerviniScore = pick.MinerviniScore,
                MarketDirection = "",
                Notes          = $"Auto-promoted by screener. RS={pick.RsRating:F0} EPS={pick.EpsGrowth:F0}%",
                Status         = "Planned",
                IsPaperTrade   = true
            });

            promoted++;
            _logger.LogInformation("Auto-promoted {Symbol} (M={M} C={C} RS={RS})",
                pick.Symbol, pick.MinerviniScore, pick.CanslimScore, pick.RsRating);
        }

        await _db.SaveChangesAsync();
        _logger.LogInformation("Auto-promoted {Count} new picks to Planned setups.", promoted);
    }

    private int CalculateCanslimScore(Stock stock)
    {
        int score = 0;
        if (stock.EpsGrowthQoQ >= 25) score++;      // C
        if (stock.EpsGrowthAnnual >= 25) score++;    // A
        // N = New product — manual
        if (stock.Float < 50_000_000) score++;       // S — low float
        if (stock.RsRating >= 80) score++;           // L
        // I = Institutional — manual
        // M = Market — manual
        return score;
    }
}

// ─── Position Service ─────────────────────────────────────────
public class PositionService
{
    private readonly AppDbContext _db;
    private readonly AlpacaDataService _alpaca;

    public PositionService(AppDbContext db, AlpacaDataService alpaca)
    {
        _db = db;
        _alpaca = alpaca;
    }

    public async Task<List<PositionWithPnL>> GetOpenPositionsAsync()
    {
        var positions = await _db.Positions
            .Include(p => p.TradeSetup)
            .Where(p => p.Status == "Open" || p.Status == "PendingFill")
            .ToListAsync();

        var result = new List<PositionWithPnL>();
        foreach (var pos in positions)
        {
            var snapshot = await _alpaca.GetSnapshotAsync(pos.Symbol);
            var currentPrice = snapshot?.LatestPrice ?? pos.EntryPrice;
            var pnl = (currentPrice - pos.EntryPrice) * pos.Shares;
            var pnlPct = (currentPrice - pos.EntryPrice) / pos.EntryPrice * 100;

            result.Add(new PositionWithPnL
            {
                Position = pos,
                CurrentPrice = currentPrice,
                UnrealizedPnL = pnl,
                UnrealizedPnLPct = pnlPct,
                DaysHeld = (DateTime.UtcNow - pos.EntryDate).Days,
                IsNearStop = currentPrice <= pos.StopLoss * 1.02m,
                IsAtTarget20 = pnlPct >= 20
            });
        }

        return result;
    }
}

public class PositionWithPnL
{
    public Position Position { get; set; } = null!;
    public decimal CurrentPrice { get; set; }
    public decimal UnrealizedPnL { get; set; }
    public decimal UnrealizedPnLPct { get; set; }
    public int DaysHeld { get; set; }
    public bool IsNearStop { get; set; }
    public bool IsAtTarget20 { get; set; }
}

// ─── Journal / Analytics Service ─────────────────────────────
public class JournalService
{
    private readonly AppDbContext _db;

    public JournalService(AppDbContext db) => _db = db;

    public async Task<PerformanceStats> GetPerformanceStatsAsync()
    {
        var trades = await _db.TradeJournal.ToListAsync();
        if (!trades.Any()) return new PerformanceStats();

        var winners = trades.Where(t => t.RealizedPnL > 0).ToList();
        var losers = trades.Where(t => t.RealizedPnL <= 0).ToList();

        return new PerformanceStats
        {
            TotalTrades = trades.Count,
            Winners = winners.Count,
            Losers = losers.Count,
            WinRate = (decimal)winners.Count / trades.Count * 100,
            AvgGain = winners.Any() ? winners.Average(t => t.RealizedPnLPct) : 0,
            AvgLoss = losers.Any() ? losers.Average(t => t.RealizedPnLPct) : 0,
            TotalPnL = trades.Sum(t => t.RealizedPnL),
            ProfitFactor = losers.Any() && losers.Sum(t => Math.Abs(t.RealizedPnL)) > 0
                ? winners.Sum(t => t.RealizedPnL) / Math.Abs(losers.Sum(t => t.RealizedPnL))
                : 0,
            BestTrade = trades.OrderByDescending(t => t.RealizedPnLPct).FirstOrDefault()?.Symbol ?? "",
            WorstTrade = trades.OrderBy(t => t.RealizedPnLPct).FirstOrDefault()?.Symbol ?? ""
        };
    }
}

public class PerformanceStats
{
    public int TotalTrades { get; set; }
    public int Winners { get; set; }
    public int Losers { get; set; }
    public decimal WinRate { get; set; }
    public decimal AvgGain { get; set; }
    public decimal AvgLoss { get; set; }
    public decimal TotalPnL { get; set; }
    public decimal ProfitFactor { get; set; }
    public string BestTrade { get; set; } = "";
    public string WorstTrade { get; set; } = "";
}

// ─── Yahoo Finance Service ────────────────────────────────────
public class YahooFinanceService
{
    private readonly AppDbContext _db;
    private readonly AlpacaDataService _alpaca;
    private readonly HttpClient _http;
    private readonly ILogger<YahooFinanceService> _logger;
    private string? _crumb;

    public YahooFinanceService(AppDbContext db, AlpacaDataService alpaca, ILogger<YahooFinanceService> logger)
    {
        _db = db;
        _alpaca = alpaca;
        _logger = logger;

        // CookieContainer is required — Yahoo Finance now demands a session cookie
        // before it will return a crumb, and the crumb must be on every v10 request.
        var handler = new System.Net.Http.HttpClientHandler
        {
            CookieContainer = new System.Net.CookieContainer(),
            UseCookies = true
        };
        _http = new HttpClient(handler);
        _http.DefaultRequestHeaders.Add("User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
        _http.DefaultRequestHeaders.Add("Accept", "text/html,application/xhtml+xml,application/json,*/*");
        _http.DefaultRequestHeaders.Add("Accept-Language", "en-US,en;q=0.9");
    }

    // Yahoo Finance requires a crumb (anti-CSRF token) on every v10 request.
    // Fetch it once by visiting the consent page to get cookies, then /v1/test/getcrumb.
    private async Task EnsureCrumbAsync()
    {
        if (_crumb != null) return;
        await _http.GetAsync("https://finance.yahoo.com");
        _crumb = await _http.GetStringAsync("https://query2.finance.yahoo.com/v1/test/getcrumb");
        _logger.LogInformation("Yahoo Finance crumb acquired: {Crumb}", _crumb);
    }

    // Called weekly by Hangfire (Sunday 8 AM)
    public async Task RefreshFundamentals()
    {
        var stocks = await _db.Stocks.ToListAsync();
        int updated = 0;
        foreach (var stock in stocks)
        {
            try
            {
                await RefreshStockAsync(stock);
                updated++;
                await Task.Delay(300); // avoid rate-limiting
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Fundamentals error for {Symbol}", stock.Symbol);
            }
        }
        await _db.SaveChangesAsync();
        _logger.LogInformation("Fundamentals refresh complete: {Updated}/{Total} stocks.", updated, stocks.Count);
    }

    private async Task RefreshStockAsync(Stock stock)
    {
        await EnsureCrumbAsync();
        var modules = "defaultKeyStatistics,earningsHistory,incomeStatementHistory";
        var url = $"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{stock.Symbol}?modules={modules}&crumb={Uri.EscapeDataString(_crumb!)}";
        var json = await _http.GetStringAsync(url);

        using var doc = JsonDocument.Parse(json);
        var result = doc.RootElement
            .GetProperty("quoteSummary")
            .GetProperty("result")[0];

        // Float — shares available for trading (S in CANSLIM: supply/demand)
        if (result.TryGetProperty("defaultKeyStatistics", out var stats) &&
            stats.TryGetProperty("floatShares", out var floatEl) &&
            floatEl.TryGetProperty("raw", out var floatRaw))
        {
            stock.Float = floatRaw.GetDecimal();
        }

        // EPS Growth QoQ — current quarter vs same quarter one year ago (C in CANSLIM)
        // earningsHistory returns 4 quarters oldest→newest, so [0]=year-ago, [^1]=most recent
        if (result.TryGetProperty("earningsHistory", out var earningsHistory) &&
            earningsHistory.TryGetProperty("history", out var historyArr) &&
            historyArr.GetArrayLength() >= 4)
        {
            var history = historyArr.EnumerateArray().ToList();
            var recentEps  = GetRaw(history[^1], "epsActual");
            var yearAgoEps = GetRaw(history[0],  "epsActual");

            if (recentEps.HasValue && yearAgoEps.HasValue && yearAgoEps.Value != 0)
                stock.EpsGrowthQoQ = (recentEps.Value - yearAgoEps.Value) / Math.Abs(yearAgoEps.Value) * 100;
        }

        // EPS Growth Annual — most recent fiscal year vs prior year (A in CANSLIM)
        // incomeStatementHistory returns years newest→oldest, so [0]=recent, [1]=prior
        if (result.TryGetProperty("incomeStatementHistory", out var incomeHistory) &&
            incomeHistory.TryGetProperty("incomeStatementHistory", out var annualArr) &&
            annualArr.GetArrayLength() >= 2)
        {
            var annual = annualArr.EnumerateArray().ToList();
            var recentNet = GetRaw(annual[0], "netIncome");
            var priorNet  = GetRaw(annual[1], "netIncome");

            if (recentNet.HasValue && priorNet.HasValue && priorNet.Value != 0)
                stock.EpsGrowthAnnual = (recentNet.Value - priorNet.Value) / Math.Abs(priorNet.Value) * 100;
        }

        // RS Rating — price momentum vs S&P 500 (L in CANSLIM: leader vs laggard)
        stock.RsRating = await CalculateRsRatingAsync(stock.Symbol);
        stock.LastFundamentalsUpdate = DateTime.UtcNow;

        _logger.LogInformation(
            "Updated {Symbol}: EpsQoQ={Qoq:F1}% Annual={Ann:F1}% Float={Float:N0} RS={Rs}",
            stock.Symbol, stock.EpsGrowthQoQ, stock.EpsGrowthAnnual, stock.Float, stock.RsRating);
    }

    private async Task<decimal> CalculateRsRatingAsync(string symbol)
    {
        var symbolBars = await _alpaca.GetBarsAsync(symbol, BarTimeFrame.Day, 252);
        var spyBars    = await _alpaca.GetBarsAsync("SPY",  BarTimeFrame.Day, 252);

        if (symbolBars.Count < 63 || spyBars.Count < 63) return 50;

        var symbolCloses = symbolBars.Select(b => b.Close).ToList();
        var spyCloses    = spyBars.Select(b => b.Close).ToList();

        // IBD-style weighted momentum: recent quarters count more
        decimal stockMomentum = WeightedMomentum(symbolCloses);
        decimal spyMomentum   = WeightedMomentum(spyCloses);

        // Relative outperformance vs market → mapped to 1–99 scale
        // +50% relative = RS ~100 (capped 99), flat relative = RS 50, -50% = RS 1
        var relative = stockMomentum - spyMomentum;
        return Math.Round(Math.Min(99m, Math.Max(1m, 50m + relative * 100)));
    }

    private static decimal WeightedMomentum(List<decimal> closes)
    {
        int n = closes.Count;
        decimal current = closes[n - 1];
        // Weights: 40% on most recent quarter, 20% each on prior three quarters
        return Ret(current, closes[Math.Max(0, n - 63)])  * 0.40m   // ~3 months
             + Ret(current, closes[Math.Max(0, n - 126)]) * 0.20m   // ~6 months
             + Ret(current, closes[Math.Max(0, n - 189)]) * 0.20m   // ~9 months
             + Ret(current, closes[Math.Max(0, n - 252)]) * 0.20m;  // ~12 months
    }

    private static decimal Ret(decimal current, decimal past) =>
        past > 0 ? (current - past) / past : 0;

    private static decimal? GetRaw(JsonElement el, string property)
    {
        if (el.TryGetProperty(property, out var prop) &&
            prop.TryGetProperty("raw", out var raw))
            return raw.GetDecimal();
        return null;
    }
}
